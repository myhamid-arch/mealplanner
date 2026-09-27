// Test-only: recorded API responses (fixtures/responses/*.json, `{ status, body }` in the wire
// format) replayed through the SDK's `fetch` option, so the real 1.3.1 client parses them. No
// credential is used or needed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOnboardingModel } from "../../src/onboarding/index.js";

export const RESPONSES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "responses");

export function recorded(name: string): { status: number; body: unknown } {
  return JSON.parse(readFileSync(join(RESPONSES, `${name}.json`), "utf8")) as {
    status: number;
    body: unknown;
  };
}

/** The parse model over the named recorded responses, in order; `bodies` are the requests sent. */
export function replayModel(...names: string[]) {
  const bodies: Record<string, unknown>[] = [];
  const queue = [...names];
  const model = createOnboardingModel(
    { enabled: true, model: "claude-rec" },
    {
      apiKey: "test-key-not-real",
      maxRetries: 0,
      fetch: (_url, init) => {
        bodies.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        const name = queue.shift();
        if (name === undefined) throw new Error("no recorded response left");
        const r = recorded(name);
        return Promise.resolve(Response.json(r.body, { status: r.status }));
      },
    },
  );
  if (model === null) throw new Error("model disabled");
  return { model, bodies };
}
