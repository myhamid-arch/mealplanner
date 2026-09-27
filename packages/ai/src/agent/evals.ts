// AGT-9: the eval set's case format and grading. Cases live in `evals/agent/*.yaml`; the live run
// (`evals/agent/run.ts`, only with RUN_LLM_EVALS=1) records the tool calls of each turn and grades
// them here. A case passes when every expectation holds and no must-not check fires.
import { z } from "zod";
import { registry } from "@mealplanner/core/changes";
import { TOOL_NAMES } from "./tools/schemas.js";

const ToolName = z.enum(TOOL_NAMES as [string, ...string[]]);
const OpKind = z.string().refine((k) => registry.has(k), "an op kind in the registry (AGT-6)");
const ChangeTool = z.enum(["apply_change", "propose_change"]);

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** The admin's message. */
    prompt: z.string().min(1),
    /** The side panel's screen, if the message is sent from one. */
    screen: z.string().optional(),
    expect: z
      .object({
        /** Every one of these tools is called. */
        tools: z.array(ToolName).default([]),
        /** At least one of these tools is called. */
        anyOf: z.array(ToolName).default([]),
        /** Each op kind is sent in some change call (through `via` when given). */
        ops: z.array(OpKind).default([]),
        via: ChangeTool.optional(),
        /** An op of `kind` whose payload contains these fields (deep subset). */
        payloads: z
          .array(z.object({ kind: OpKind, match: z.record(z.string(), z.unknown()) }).strict())
          .default([]),
      })
      .strict()
      .default({ tools: [], anyOf: [], ops: [], payloads: [] }),
    mustNot: z
      .object({
        tools: z.array(ToolName).default([]),
        ops: z.array(OpKind).default([]),
        /** An op of `kind` whose payload contains these fields must not be sent. */
        payloads: z
          .array(z.object({ kind: OpKind, match: z.record(z.string(), z.unknown()) }).strict())
          .default([]),
      })
      .strict()
      .default({ tools: [], ops: [], payloads: [] }),
  })
  .strict()
  .refine(
    (c) =>
      c.expect.tools.length +
        c.expect.anyOf.length +
        c.expect.ops.length +
        c.expect.payloads.length +
        c.mustNot.tools.length +
        c.mustNot.ops.length +
        c.mustNot.payloads.length >
      0,
    "a case checks something",
  );
export type EvalCase = z.output<typeof EvalCaseSchema>;

export const EvalFileSchema = z.object({ cases: z.array(EvalCaseSchema).min(1) }).strict();

/** One tool call the model made during the turn. */
export interface RecordedCall {
  name: string;
  input: unknown;
}

interface SentOp {
  tool: string;
  kind: string;
  payload: unknown;
}

function kindOf(op: unknown): string {
  const kind = (op as { kind?: unknown } | null)?.kind;
  return typeof kind === "string" ? kind : "";
}

function sentOps(calls: readonly RecordedCall[]): SentOp[] {
  return calls.flatMap((c) => {
    if (c.name !== "apply_change" && c.name !== "propose_change") return [];
    const ops = (c.input as { ops?: unknown } | null)?.ops;
    return Array.isArray(ops)
      ? ops.map((op) => ({
          tool: c.name,
          kind: kindOf(op),
          payload: (op as { payload?: unknown } | null)?.payload,
        }))
      : [];
  });
}

/**
 * Deep subset: every field of `match` is present in `value` with an equal (or subset) value. Arrays
 * match as sets of the same size (weekdays may come in any order).
 */
export function contains(value: unknown, match: unknown): boolean {
  if (match === null || typeof match !== "object") return value === match;
  if (Array.isArray(match))
    return (
      Array.isArray(value) &&
      value.length === match.length &&
      match.every((m) => value.some((v) => contains(v, m)))
    );
  if (value === null || typeof value !== "object") return false;
  return Object.entries(match).every(([k, m]) =>
    contains((value as Record<string, unknown>)[k], m),
  );
}

export interface Grade {
  id: string;
  pass: boolean;
  failures: string[];
}

export function gradeCase(c: EvalCase, calls: readonly RecordedCall[]): Grade {
  const failures: string[] = [];
  const names = new Set(calls.map((x) => x.name));
  const ops = sentOps(calls);
  for (const t of c.expect.tools) if (!names.has(t)) failures.push(`expected a ${t} call`);
  if (c.expect.anyOf.length > 0 && !c.expect.anyOf.some((t) => names.has(t)))
    failures.push(`expected one of ${c.expect.anyOf.join(", ")}`);
  for (const kind of c.expect.ops) {
    const sent = ops.filter((o) => o.kind === kind);
    if (sent.length === 0) failures.push(`expected a ${kind} op`);
    else if (c.expect.via !== undefined && !sent.some((o) => o.tool === c.expect.via))
      failures.push(
        `expected ${kind} through ${c.expect.via}, got ${sent.map((o) => o.tool).join(", ")}`,
      );
  }
  for (const p of c.expect.payloads)
    if (!ops.some((o) => o.kind === p.kind && contains(o.payload, p.match)))
      failures.push(`expected a ${p.kind} op with ${JSON.stringify(p.match)}`);
  for (const t of c.mustNot.tools) if (names.has(t)) failures.push(`must not call ${t}`);
  for (const kind of c.mustNot.ops)
    if (ops.some((o) => o.kind === kind)) failures.push(`must not send a ${kind} op`);
  for (const p of c.mustNot.payloads)
    if (ops.some((o) => o.kind === p.kind && contains(o.payload, p.match)))
      failures.push(`must not send ${p.kind} with ${JSON.stringify(p.match)}`);
  return { id: c.id, pass: failures.length === 0, failures };
}

/** AGT-9 / G4: the pass rate, measured. */
export function passRate(grades: readonly Grade[]): number {
  return grades.length === 0 ? 0 : grades.filter((g) => g.pass).length / grades.length;
}

export const EVAL_PASS_THRESHOLD = 0.9;
