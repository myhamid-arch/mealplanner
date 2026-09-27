// Recorded model responses for the node gates (SPEC-Q-6, R-69): a local HTTP server that answers the
// Messages API from recording files under `test/node/recorded/`. The built web app and the worker
// reach it through ANTHROPIC_BASE_URL with a placeholder ANTHROPIC_AUTH_TOKEN, so their production
// model code runs unchanged: the agent's streamed request gets a server-sent event stream, the
// worker's structured request a JSON message. Each recording states what the request it answers
// must contain; a request with no matching recording, or one that does not match, is answered 500
// and recorded as a failure, which the tests assert is empty. No request leaves this machine.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RECORDED_DIR = join(dirname(fileURLToPath(import.meta.url)), "recorded");

export type Block =
  { type: "text"; text: string } | { type: "tool_use"; id?: string; name: string; input: unknown };

/** One recorded exchange: what the request must carry, and the response to it. */
export interface Recording {
  /** A label for failures and logs. */
  name: string;
  /**
   * Answers every matching request, in any order and any number of times (requests whose count
   * depends on the page's timing, such as the onboarding parse after typing stops). Recordings
   * without it answer exactly one request each, in order.
   */
  repeat?: boolean;
  expect: {
    /** The request streams (the agent) or not (structured calls). */
    stream: boolean;
    /** Substrings of the last user message's text blocks. */
    lastUserText?: string[];
    /** The last user message answers a tool call of this name… */
    toolResultOf?: string;
    /** …and its tool_result text contains these substrings. */
    toolResultContains?: string[];
    /** Substrings of the system prompt. */
    systemContains?: string[];
  };
  response: { content: Block[]; stop_reason: "end_turn" | "tool_use" };
}

export interface RecordedModel {
  url: string;
  /** Every request body received, in order. */
  requests: unknown[];
  /** How many requests each recording answered, by name. */
  answered: Map<string, number>;
  /** Requests that no recording answered, with the reason. */
  failures: string[];
  /** Recordings not used yet. */
  remaining(): string[];
  /** Adds recordings to answer after the ones already queued. */
  add(recordings: Recording[]): void;
  close(): Promise<void>;
}

/** Reads `recorded/<file>.json`, replacing `{{name}}` placeholders with `values`. */
export function loadRecordings(file: string, values: Record<string, string>): Recording[] {
  let text = readFileSync(join(RECORDED_DIR, `${file}.json`), "utf8");
  for (const [k, v] of Object.entries(values)) text = text.replaceAll(`{{${k}}}`, v);
  const unresolved = /\{\{(\w+)\}\}/.exec(text);
  if (unresolved !== null)
    throw new Error(`recording ${file}: no value for {{${unresolved[1] ?? ""}}}`);
  return (JSON.parse(text) as { recordings: Recording[] }).recordings;
}

type Message = { role: string; content: string | { type: string; [k: string]: unknown }[] };
type Body = {
  model?: string;
  stream?: boolean;
  system?: string | { type: string; text?: string }[];
  messages?: Message[];
};

function textOf(content: Message["content"] | undefined): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");
}

function toolResults(body: Body): { name: string; text: string }[] {
  const messages = body.messages ?? [];
  const last = messages.at(-1);
  if (last === undefined || typeof last.content === "string") return [];
  const assistant = messages.at(-2);
  const uses = new Map<string, string>();
  if (assistant !== undefined && typeof assistant.content !== "string")
    for (const b of assistant.content)
      if (b.type === "tool_use") uses.set(String(b.id), String(b.name));
  return last.content
    .filter((b) => b.type === "tool_result")
    .map((b) => ({
      name: uses.get(String(b.tool_use_id)) ?? "?",
      text: typeof b.content === "string" ? b.content : JSON.stringify(b.content),
    }));
}

function systemText(body: Body): string {
  if (typeof body.system === "string") return body.system;
  return (body.system ?? []).map((b) => b.text ?? "").join("\n");
}

/** Why `r` does not answer `body`, or null when it does. */
function mismatch(r: Recording, body: Body): string | null {
  const e = r.expect;
  if (Boolean(body.stream) !== e.stream) return `stream ${String(body.stream)}`;
  const last = body.messages?.at(-1);
  for (const s of e.lastUserText ?? [])
    if (last?.role !== "user" || !textOf(last.content).includes(s))
      return `last user text lacks "${s}"`;
  if (e.toolResultOf !== undefined) {
    const result = toolResults(body).find((t) => t.name === e.toolResultOf);
    if (result === undefined) return `no tool_result of ${e.toolResultOf}`;
    for (const s of e.toolResultContains ?? [])
      if (!result.text.includes(s)) return `${e.toolResultOf} result lacks "${s}"`;
  }
  for (const s of e.systemContains ?? [])
    if (!systemText(body).includes(s)) return `system prompt lacks "${s}"`;
  return null;
}

let seq = 0;

function message(model: string, r: Recording) {
  seq += 1;
  return {
    id: `msg_recorded_${String(seq)}`,
    type: "message",
    role: "assistant",
    model,
    content: r.response.content.map((b, i) =>
      b.type === "tool_use"
        ? { ...b, id: b.id ?? `toolu_recorded_${String(seq)}_${String(i)}` }
        : b,
    ),
    stop_reason: r.response.stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

/** The server-sent events a streamed Messages API response consists of. */
function sse(m: ReturnType<typeof message>): string {
  const out: string[] = [];
  const send = (type: string, data: unknown) =>
    out.push(`event: ${type}\ndata: ${JSON.stringify({ type, ...(data as object) })}\n\n`);
  send("message_start", {
    message: {
      ...m,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  });
  m.content.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", {
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      send("content_block_delta", {
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", {
    delta: { stop_reason: m.stop_reason, stop_sequence: null },
    usage: { output_tokens: 20 },
  });
  send("message_stop", {});
  return out.join("");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => (data += c.toString()));
    req.on("end", () => {
      resolve(data);
    });
    req.on("error", reject);
  });
}

/** Starts the server; recordings are answered in order, each only once. */
export async function startRecordedModel(recordings: Recording[]): Promise<RecordedModel> {
  const queue = recordings.filter((r) => r.repeat !== true);
  const repeatable = recordings.filter((r) => r.repeat === true);
  const answered = new Map<string, number>();
  const requests: unknown[] = [];
  const failures: string[] = [];
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      if (req.method !== "POST" || !(req.url ?? "").startsWith("/v1/messages")) {
        failures.push(`${String(req.method)} ${String(req.url)}: not the Messages API`);
        res.writeHead(404).end();
        return;
      }
      const body = JSON.parse(raw) as Body;
      requests.push(body);
      const head = queue[0];
      const headWhy = head === undefined ? "no recording left" : mismatch(head, body);
      const any = headWhy === null ? undefined : repeatable.find((r) => mismatch(r, body) === null);
      const next = headWhy === null ? head : any;
      const why = next === undefined ? headWhy : null;
      if (next === undefined || why !== null) {
        failures.push(
          `request ${String(requests.length)} ${String(req.url)} (next: ${head?.name ?? "none"}): ${String(why)}`,
        );
        res.writeHead(500, { "content-type": "application/json" }).end(
          JSON.stringify({
            type: "error",
            error: { type: "api_error", message: `unrecorded request: ${String(why)}` },
          }),
        );
        return;
      }
      if (next === head) queue.shift();
      answered.set(next.name, (answered.get(next.name) ?? 0) + 1);
      const m = message(body.model ?? "claude-recorded", next);
      if (body.stream === true) {
        res.writeHead(200, { "content-type": "text/event-stream", "request-id": `req_${m.id}` });
        res.end(sse(m));
      } else {
        res.writeHead(200, { "content-type": "application/json", "request-id": `req_${m.id}` });
        res.end(JSON.stringify(m));
      }
    })().catch((error: unknown) => {
      failures.push(String(error));
      res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    failures,
    answered,
    remaining: () => queue.map((r) => r.name),
    add: (more) => {
      queue.push(...more.filter((r) => r.repeat !== true));
      repeatable.push(...more.filter((r) => r.repeat === true));
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** Environment that points a child's model client at the recorded server (no credential). */
export function recordedModelEnv(model: RecordedModel): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: model.url,
    ANTHROPIC_AUTH_TOKEN: "recorded-response-placeholder",
  };
}
