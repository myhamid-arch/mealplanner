// Proactive `event` messages (AGT-7; SPEC-Q-9, R-46): the insights digest (with the changes made
// automatically since the previous one, W-9a) and job completions: into the conversation of the
// agent turn that started the job, or, for a plan no turn started, into Updates (W-9b). As
// event-row content (text + cards); the worker posts them.
import { cardJson, type Card, type Json, type PlanReady } from "./cards.js";
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

/**
 * A `learning` change set applied without a proposal (FBK-5, W-9a): its `portion_bias.set` moves
 * with the member's name and the bias before and after (leaf-1.4.9 SPEC-Q-1, SPEC-Q-2).
 */
export interface AutomaticChangeLike {
  changeSetId: string;
  summary: string;
  appliedAt: Date | string;
  undone: boolean;
  moves: { memberName: string; role: string; before: number; after: number }[];
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/**
 * "Zayd's carb portion is 10% smaller" (SPEC-Q-2): per member, the roles that moved by the same
 * percentage and direction; the change set's summary when no move can be read.
 */
export function automaticChangeTitle(c: AutomaticChangeLike): string {
  const groups = new Map<
    string,
    { member: string; pct: number; smaller: boolean; roles: string[] }
  >();
  for (const m of c.moves) {
    if (!(m.before > 0) || !Number.isFinite(m.after) || m.after === m.before) continue;
    const pct = Math.round(Math.abs(m.after / m.before - 1) * 100);
    if (pct === 0) continue;
    const smaller = m.after < m.before;
    const key = `${m.memberName}\u0000${String(pct)}\u0000${String(smaller)}`;
    const role = m.role.replace(/_/g, " ");
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { member: m.memberName, pct, smaller, roles: [role] });
    else if (!g.roles.includes(role)) g.roles.push(role);
  }
  if (groups.size === 0) return c.summary;
  return [...groups.values()]
    .map(
      (g) =>
        `${g.member}'s ${joinAnd(g.roles)} ${g.roles.length === 1 ? "portion is" : "portions are"} ${String(g.pct)}% ${g.smaller ? "smaller" : "larger"}`,
    )
    .join("; ");
}

/** Whether a digest is worth a message: something stored, a note, or a change made automatically. */
export function digestHasNews(
  d: InsightDigestLike,
  automatic: readonly AutomaticChangeLike[] = [],
): boolean {
  return d.stored.length > 0 || d.notes.length > 0 || automatic.length > 0;
}

export function insightDigestEvent(
  d: InsightDigestLike,
  automatic: readonly AutomaticChangeLike[] = [],
): Json {
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
    ...(automatic.length === 0
      ? {}
      : {
          automatic: automatic.map((a) => ({
            changeSetId: a.changeSetId,
            title: automaticChangeTitle(a),
            detail: a.summary,
            appliedAt: iso(a.appliedAt),
            undone: a.undone,
          })),
        }),
  };
  const n = d.stored.length;
  const a = automatic.length;
  const done =
    a === 0
      ? ""
      : ` ${a === 1 ? "One change was" : `${String(a)} changes were`} made automatically; you can undo ${a === 1 ? "it" : "them"}.`;
  const text =
    n === 0 && d.notes.length === 0 && a > 0
      ? `I looked at the latest reviews.${done}`
      : n === 0
        ? `I looked at the latest reviews: ${String(d.notes.length)} note(s), no new proposals.${done}`
        : `I looked at the latest reviews and have ${String(n)} new proposal${n === 1 ? "" : "s"} for you.${done}`;
  return eventRowContent({ text, cards: [cardJson(card) as unknown as Card] });
}

export interface JobLike {
  id: string;
  kind: string;
  status: "succeeded" | "failed" | "cancelled";
  /** The job's result (`done` payload) or error. */
  result: Json;
  /** `recipe.draft`: the day and slot the request named (both), for the card's "Use for" link. */
  use?: { date: string; slotKey: string; slotLabel: string };
}

const JOB_NAMES: Record<string, string> = {
  "plan.generate": "The plan",
  "insights.run": "The insights run",
  "recipe.draft": "The recipe ideas",
};

/**
 * A finished plan no agent turn started, for Updates (W-9b, leaf-1.4.9 SPEC-Q-5): per meal, its
 * slot, whether it is packed or a training slot, who eats it (names) and whether any targeted
 * plate missed its target.
 */
export interface PlanReadyLike {
  dates: string[];
  meals: {
    slotLabel: string;
    isPacked: boolean;
    isTraining: boolean;
    attendees: string[];
    targeted: boolean;
    offTarget: boolean;
  }[];
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekday(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : (WEEKDAYS[d.getUTCDay()] ?? date);
}

function plural(n: number, label: string): string {
  const lower = label.toLowerCase();
  if (n === 1) return `1 ${lower}`;
  const many = /(s|x|ch|sh)$/.test(lower) ? `${lower}es` : `${lower}s`;
  return `${String(n)} ${many}`;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** The ChatPhoneDigest row: "Monday's plan is ready", its facts and the link to the plan. */
export function planReady(p: PlanReadyLike): PlanReady {
  const dates = [...p.dates].sort();
  const first = dates[0] ?? "";
  const last = dates[dates.length - 1] ?? first;
  const title =
    dates.length <= 1
      ? `${weekday(first)}'s plan is ready`
      : `The plan from ${weekday(first)} to ${weekday(last)} is ready`;
  const facts: string[] = [];
  const targeted = p.meals.filter((m) => m.targeted);
  if (targeted.length > 0) {
    const off = targeted.filter((m) => m.offTarget).length;
    facts.push(off === 0 ? "All meals on target" : `${plural(off, "meal")} off target`);
  }
  // Lunch boxes, not meals: one shared packed lunch for three children is three lunches.
  const packed = new Map<string, number>();
  for (const m of p.meals)
    if (m.isPacked)
      packed.set(m.slotLabel, (packed.get(m.slotLabel) ?? 0) + Math.max(1, m.attendees.length));
  for (const [label, n] of packed) facts.push(plural(n, label));
  const trainees = [...new Set(p.meals.filter((m) => m.isTraining).flatMap((m) => m.attendees))];
  if (trainees.length > 0)
    facts.push(`${joinAnd(trainees.map(possessive))} training-day meals included`);
  return {
    title,
    facts,
    href: first === "" ? "/plan" : `/plan?week=${first}`,
    action: "Look, then send to kitchen",
  };
}

/**
 * A job has finished. Without `plan`: the completion of a job the agent started, posted into its
 * conversation (SPEC-Q-9); `recipe.draft` carries the recipe card. With `plan`: a plan job no
 * agent turn started, announced in Updates as the ChatPhoneDigest row (W-9b).
 */
export function jobCompletionEvent(job: JobLike, plan?: PlanReadyLike): Json {
  if (plan !== undefined && job.status === "succeeded") {
    const card: Card = {
      type: "job_progress",
      jobId: job.id,
      kind: job.kind,
      status: "succeeded",
      ready: planReady(plan),
    };
    // The card carries the title (ChatPhoneDigest shows the row alone).
    return eventRowContent({ text: "", cards: [cardJson(card) as unknown as Card] });
  }
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
    cards.push({
      type: "recipe",
      jobId: job.id,
      dishes,
      rejected,
      ...(job.use === undefined ? {} : { use: job.use }),
    });
    text =
      dishes.length === 0
        ? "No recipe passed the checks this time; the reasons are listed."
        : `Here ${dishes.length === 1 ? "is a recipe draft" : `are ${String(dishes.length)} recipe drafts`}. Save the ones you want.`;
  }
  return eventRowContent({ text, cards: cards.map((c) => cardJson(c) as unknown as Card) });
}
