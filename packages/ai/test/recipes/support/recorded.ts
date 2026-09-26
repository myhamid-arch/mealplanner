// Recorded API responses through the real SDK: an Anthropic client whose `fetch` returns queued
// wire responses and keeps every request (url, headers, parsed body). Only the network is
// replaced; the SDK's request building, error classes, retries and parsing all run.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_MODEL } from "../../../src/client/index.js";
import type { DishBatch } from "../../../src/recipes/index.js";
import { repoRoot } from "./catalogue.js";

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The request body exactly as sent. */
  raw: string;
  body: Record<string, unknown>;
};

export type RecordedResponse =
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { networkError: string };

export type Recorder = { anthropic: Anthropic; requests: RecordedRequest[]; remaining(): number };

/** A client that answers from `responses` in order and records every request. */
export function recordedClient(
  responses: readonly RecordedResponse[],
  options: { maxRetries?: number } = {},
): Recorder {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = typeof init?.body === "string" ? init.body : "";
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers,
      raw,
      body: raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>),
    });
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error("no recorded response left"));
    if ("networkError" in next) return Promise.reject(new TypeError(next.networkError));
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json", "request-id": `req_recorded_${String(requests.length)}`, ...next.headers },
      }),
    );
  };
  const anthropic = new Anthropic({
    apiKey: "sk-ant-test-not-a-real-key",
    fetch,
    maxRetries: options.maxRetries ?? 0,
  });
  return { anthropic, requests, remaining: () => queue.length };
}

let counter = 0;

/** A wire `message` response carrying `batch` as structured output, after a thinking block. */
export function batchResponse(
  batch: DishBatch,
  options: { model?: string; cacheRead?: number } = {},
): RecordedResponse {
  counter += 1;
  return {
    status: 200,
    body: {
      id: `msg_recorded_${String(counter)}`,
      type: "message",
      role: "assistant",
      model: options.model ?? DEFAULT_MODEL,
      content: [
        { type: "thinking", thinking: "", signature: `sig_recorded_${String(counter)}` },
        { type: "text", text: JSON.stringify(batch), citations: null },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      stop_details: null,
      usage: {
        input_tokens: 2100,
        output_tokens: 6400,
        cache_creation_input_tokens: options.cacheRead === undefined ? 14000 : 0,
        cache_read_input_tokens: options.cacheRead ?? 0,
      },
    },
  };
}

/** A recorded wire response from test/recipes/fixtures/responses/<name>.json. */
export function wireFixture(name: string): RecordedResponse {
  const path = join(repoRoot(), "packages/ai/test/recipes/fixtures/responses", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as RecordedResponse;
}

/** A recorded batch from test/recipes/fixtures/<name>.json. */
export function batchFixture(name: string): DishBatch {
  const path = join(repoRoot(), "packages/ai/test/recipes/fixtures", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as DishBatch;
}
