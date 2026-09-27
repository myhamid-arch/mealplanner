// Proactive `event` messages (AGT-7; SPEC-Q-9, R-46): the insights digest and the completion of
// jobs the agent started, as event-row content (text + cards). The worker posts them.
import { cardJson, type Card, type Json } from "./cards.js";
import { eventRowContent } from "./history.js";

/** What an insights run stored and dropped (1.3.3's `InsightDigest`, structurally). */
export interface InsightDigestLike {
  runAt: Date | string;
  stored: { id: string; kind: string; payload: unknown; rationale: string }[];
  dropped: { title: string; reason: string; detail?: string }[];
  notes: { title: string; rationale: string }[];
}

function iso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function titleOf(payload: unknown, fallback: string): string {
  const title = (payload as { title?: unknown } | null)?.title;
  return typeof title === "string" && title !== "" ? title : fallback;
}

/** Whether a digest is worth a message: something stored or a note to read. */
export function digestHasNews(d: InsightDigestLike): boolean {
  return d.stored.length > 0 || d.notes.length > 0;
}

export function insightDigestEvent(d: InsightDigestLike): Json {
  const card: Card = {
    type: "insight_digest",
    runAt: iso(d.runAt),
    proposals: d.stored.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: titleOf(p.payload, p.kind),
      rationale: p.rationale,
    })),
    dropped: d.dropped.map((x) => ({ title: x.title, reason: x.reason })),
    notes: d.notes.map((n) => ({ title: n.title, rationale: n.rationale })),
  };
  const n = d.stored.length;
  const text =
    n === 0
      ? `I looked at the latest reviews: ${String(d.notes.length)} note(s), no new proposals.`
      : `I looked at the latest reviews and have ${String(n)} new proposal${n === 1 ? "" : "s"} for you.`;
  return eventRowContent({ text, cards: [cardJson(card) as unknown as Card] });
}

export interface JobLike {
  id: string;
  kind: string;
  status: "succeeded" | "failed" | "cancelled";
  /** The job's result (`done` payload) or error. */
  result: Json;
}

const JOB_NAMES: Record<string, string> = {
  "plan.generate": "The plan",
  "insights.run": "The insights run",
  "recipe.draft": "The recipe ideas",
};

/** A job the agent started has finished (SPEC-Q-9). `recipe.draft` carries the recipe card. */
export function jobCompletionEvent(job: JobLike): Json {
  const name = JOB_NAMES[job.kind] ?? `The ${job.kind} job`;
  const cards: Card[] = [];
  const progress: Card = {
    type: "job_progress",
    jobId: job.id,
    kind: job.kind,
    status: job.status,
  };
  if (job.status !== "succeeded") {
    const message = (job.result as { message?: unknown } | null)?.message;
    if (typeof message === "string") progress.error = message;
  }
  cards.push(progress);
  let text =
    job.status === "succeeded" ? `${name} is ready.` : `${name} did not finish (${job.status}).`;
  if (job.kind === "recipe.draft" && job.status === "succeeded") {
    const r = (job.result ?? {}) as { dishes?: unknown; rejected?: unknown };
    const dishes = Array.isArray(r.dishes) ? (r.dishes as Json[]) : [];
    const rejected = Array.isArray(r.rejected) ? (r.rejected as Json[]) : [];
    cards.push({ type: "recipe", jobId: job.id, dishes, rejected });
    text =
      dishes.length === 0
        ? "No recipe passed the checks this time; the reasons are listed."
        : `Here ${dishes.length === 1 ? "is a recipe draft" : `are ${String(dishes.length)} recipe drafts`}. Save the ones you want.`;
  }
  return eventRowContent({ text, cards: cards.map((c) => cardJson(c) as unknown as Card) });
}
