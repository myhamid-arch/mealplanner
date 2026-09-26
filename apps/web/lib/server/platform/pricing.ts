// AI cost for the platform console (R2-ADM-8; leaf-1.4.1 SPEC-Q-7). USD per million tokens, from the
// `claude-api` skill's "Current Models" table (cached 2026-06-24), read at build time. Cache reads
// are the table's stated rate where it gives one (Claude Fable 5.1 $0.25, Claude Opus 5.5 $0.20),
// otherwise 0.1 × the input rate (the skill's "~0.1x cost" for cache hits). `ai_generation` records
// no cache-write tokens, so cache writes are not priced. A model not listed costs `null`.
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

const tenth = (input: number, output: number): ModelPrice => ({
  input,
  output,
  cacheRead: input / 10,
});

export const PRICES_PER_MTOK: Readonly<Record<string, ModelPrice>> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": tenth(10, 50),
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": tenth(5, 25),
  "claude-opus-4-8": tenth(5, 25),
  "claude-opus-4-7": tenth(5, 25),
  "claude-opus-4-6": tenth(5, 25),
  "claude-sonnet-5": tenth(2, 10),
  "claude-sonnet-4-6": tenth(3, 15),
  "claude-haiku-4-5": tenth(1, 5),
};

/** USD for one row of token counts; null when the model has no listed price. */
export function costUsd(
  model: string,
  t: { inputTokens: number; outputTokens: number; cacheReadTokens: number },
): number | null {
  const p = PRICES_PER_MTOK[model];
  if (p === undefined) return null;
  return (
    (t.inputTokens * p.input + t.outputTokens * p.output + t.cacheReadTokens * p.cacheRead) /
    1_000_000
  );
}
