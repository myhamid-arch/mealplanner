// AGT-9: runs the agent eval set against the live model. It costs money, so it runs only with
// RUN_LLM_EVALS=1 and an Anthropic credential, and it is not part of CI. G4 passes at ≥ 90 %.
//
//   pnpm -r build
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=… node evals/agent/run.ts [case-id …]
//
// With EVAL_TRANSCRIPTS=<dir>, each case's stored rows (the exact content blocks, tool results
// included) and the writes its ports recorded are written to <dir>/<case-id>.json for diagnosis.
//
// Each case is one user turn of the real loop (`runAgentTurn`) with the live model, in-memory
// ports over the eval household (household.ts), and a fresh conversation. The tool calls of the
// turn are graded by `gradeCase`.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  EVAL_PASS_THRESHOLD,
  EvalFileSchema,
  agentEffort,
  createAgentModel,
  gradeCase,
  householdDigest,
  passRate,
  runAgentTurn,
  screenContextText,
  type EvalCase,
  type Json,
  type RecordedCall,
  type StoredMessage,
} from "../../packages/ai/dist/src/agent/index.js";
import { resolveClaudeConfig } from "../../packages/ai/dist/src/client/index.js";
import { evalDigestSnapshot, evalPorts, type EvalRecord } from "./household.ts";

const DIR = import.meta.dirname;
// js-yaml is a dev dependency of packages/ai.
const yaml = createRequire(join(DIR, "../../packages/ai/package.json"))("js-yaml") as {
  load(text: string): unknown;
};

export function loadCases(): EvalCase[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .flatMap((f) => EvalFileSchema.parse(yaml.load(readFileSync(join(DIR, f), "utf8"))).cases);
}

function memoryStore(rows: StoredMessage[]) {
  return {
    append(role: StoredMessage["role"], content: Json): Promise<StoredMessage> {
      const row: StoredMessage = {
        id: `row-${String(rows.length + 1)}`,
        role,
        content: JSON.parse(JSON.stringify(content)) as Json,
        createdAt: new Date().toISOString(),
      };
      rows.push(row);
      return Promise.resolve(row);
    },
  };
}

function toolCalls(rows: readonly StoredMessage[]): RecordedCall[] {
  return rows
    .filter((r) => r.role === "assistant" && Array.isArray(r.content))
    .flatMap((r) => r.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ name: b.name ?? "", input: b.input }));
}

async function main(): Promise<number> {
  if (process.env.RUN_LLM_EVALS !== "1") {
    console.error(
      "The agent eval calls the live model and costs money: set RUN_LLM_EVALS=1 to run it.",
    );
    return 2;
  }
  const model = createAgentModel(resolveClaudeConfig(), agentEffort());
  if (model === null) {
    console.error("No Anthropic credential is configured (set ANTHROPIC_API_KEY).");
    return 2;
  }
  const only = new Set(process.argv.slice(2));
  const cases = loadCases().filter((c) => only.size === 0 || only.has(c.id));
  const transcripts = process.env.EVAL_TRANSCRIPTS?.trim();
  if (transcripts !== undefined && transcripts !== "") mkdirSync(transcripts, { recursive: true });
  const grades = [];
  for (const c of cases) {
    const rows: StoredMessage[] = [];
    const record: EvalRecord = { writes: [] };
    const outcome = await runAgentTurn({
      model,
      ports: evalPorts(record),
      store: memoryStore(rows),
      history: [],
      text: c.prompt,
      screen: c.screen === undefined ? null : screenContextText(c.screen),
      digest: householdDigest(evalDigestSnapshot(new Date())),
      sink: () => undefined,
      signal: new AbortController().signal,
      recordCall: () => Promise.resolve(),
      onUnexpected: (error, tool) => {
        console.error(`${c.id}: ${tool} failed`, error);
      },
    });
    const calls = toolCalls(rows);
    const grade = gradeCase(c, calls);
    grades.push(grade);
    if (transcripts !== undefined && transcripts !== "")
      writeFileSync(
        join(transcripts, `${c.id}.json`),
        `${JSON.stringify(
          {
            case: c.id,
            prompt: c.prompt,
            model: model.model,
            stopReason: outcome.stopReason,
            grade,
            rows,
            writes: record.writes,
          },
          null,
          2,
        )}\n`,
      );
    console.log(
      `${grade.pass ? "PASS" : "FAIL"} ${c.id} (${outcome.stopReason}, ${String(outcome.modelCalls)} calls; tools: ${calls.map((x) => x.name).join(", ") || "none"})${grade.pass ? "" : `\n     ${grade.failures.join("\n     ")}`}`,
    );
  }
  const rate = passRate(grades);
  console.log(
    `AGENT EVAL ${String(grades.filter((g) => g.pass).length)}/${String(grades.length)} passed (${(rate * 100).toFixed(1)} %, threshold ${String(EVAL_PASS_THRESHOLD * 100)} %) with ${model.model}`,
  );
  return rate >= EVAL_PASS_THRESHOLD ? 0 : 1;
}

process.exitCode = await main();
