// First-days follow-up questions (R2-ONB-6; FirstDaysPhone.dc.html; leaf-1.4.7 SPEC-Q-8/9). The
// five onboarding answers are not stored; what they set is. So the engine reads the saved
// configuration and proposes only what that configuration leaves open, for example whether the
// school is nut-free, when dinner is, or whether training days need more energy. Each follow-up is
// one question with one-tap choices; an answer maps to change ops (or to none), which the caller
// applies as one change set. Pure: no I/O, no clock (the caller passes the local dates).
import type { ChangeOp } from "../../changes/index.js";
import { DEFAULT_SLOTS, type HouseholdConfig } from "../../types/index.js";
import { listJoin } from "../text.js";

export const FOLLOWUP_STATUSES = ["answered", "dismissed"] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_KINDS = ["school_nut_free", "dinner_time", "training_kcal"] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

/** The configuration a follow-up is judged against. */
export type FollowupConfig = Pick<
  HouseholdConfig,
  "members" | "targetProfiles" | "slotTypes" | "memberSlotSchedules" | "trainingSchedules" | "exclusions"
>;

export interface FollowupChoice {
  id: string;
  label: string;
  /** Where the rest of this answer is entered, shown after the tap (no numbers are invented). */
  then?: { label: string; href: string };
}

export interface Followup {
  /** Stable per household: `school_nut_free`, `dinner_time`, `training_kcal:<member id>`. */
  key: string;
  kind: FollowupKind;
  memberId: string | null;
  question: string;
  choices: FollowupChoice[];
  /** A screen for answers the choices do not cover. */
  more: { label: string; href: string } | null;
}

/** A stored answer or dismissal. `resolvedOn` is its date in the household's time zone. */
export interface FollowupState {
  key: string;
  status: FollowupStatus;
  choice: string | null;
  resolvedOn: string;
  resolvedAt: Date;
}

export class FollowupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FollowupError";
  }
}

/** Keeping nuts out of the school children's meals (R-56: member-level, no slot scope, W-8). */
export const NUT_FLAG = "contains_nuts";
const SCHOOL_SLOT = "packed_school_lunch";
const DINNER_SLOT = "dinner";
const DINNER_DEFAULT_TIME = DEFAULT_SLOTS.find((s) => s.key === DINNER_SLOT)?.defaultTime ?? "19:30:00";
/** One-tap alternatives to the default dinner time. */
export const DINNER_TIMES = ["19:00:00", "20:00:00", "20:30:00"] as const;

const hhmm = (time: string) => time.slice(0, 5);

function activeMembers(cfg: FollowupConfig) {
  return cfg.members.filter((m) => m.archivedAt === null);
}

/** Active members who attend the school lunch box on at least one weekday. */
export function schoolChildren(cfg: FollowupConfig) {
  const slot = cfg.slotTypes.find((s) => s.key === SCHOOL_SLOT && s.active);
  if (slot === undefined) return [];
  const attending = new Set(
    cfg.memberSlotSchedules
      .filter((r) => r.slotTypeId === slot.id && r.attends)
      .map((r) => r.memberId),
  );
  return activeMembers(cfg).filter((m) => attending.has(m.id));
}

function nutFreeFor(cfg: FollowupConfig, memberId: string): boolean {
  // R-34: every exclusion row filters, whatever its `hard` flag.
  return cfg.exclusions.some(
    (e) =>
      e.kind === "dietary_flag" &&
      e.key === NUT_FLAG &&
      (e.memberId === null || e.memberId === memberId),
  );
}

function schoolNutFree(cfg: FollowupConfig): Followup | null {
  const kids = schoolChildren(cfg);
  if (kids.length === 0 || kids.every((k) => nutFreeFor(cfg, k.id))) return null;
  const names = listJoin(kids.map((k) => k.displayName));
  return {
    key: "school_nut_free",
    kind: "school_nut_free",
    memberId: null,
    question: `Is the school nut-free? I'll keep nuts out of ${names}'s meals.`,
    choices: [
      { id: "yes", label: "Yes, nut-free" },
      { id: "no", label: "No" },
    ],
    more: null,
  };
}

function dinnerTime(cfg: FollowupConfig): Followup | null {
  const slot = cfg.slotTypes.find((s) => s.key === DINNER_SLOT && s.active);
  // Settled once anyone has set the time (it is no longer the PLN-2 default).
  if (slot === undefined || slot.defaultTime !== DINNER_DEFAULT_TIME) return null;
  return {
    key: "dinner_time",
    kind: "dinner_time",
    memberId: null,
    question: `Dinner at ${hhmm(slot.defaultTime)} — is that about right?`,
    choices: [
      { id: "yes", label: `Yes, ${hhmm(slot.defaultTime)}` },
      ...DINNER_TIMES.map((t) => ({ id: hhmm(t), label: hhmm(t) })),
    ],
    more: { label: "Another time", href: `/settings/schedule?slot=${DINNER_SLOT}` },
  };
}

function trainingKcal(cfg: FollowupConfig, viewerMemberId: string | null): Followup[] {
  const training = new Set(cfg.trainingSchedules.map((t) => t.memberId));
  const withTrainingTargets = new Set(
    cfg.targetProfiles.filter((p) => p.kind === "training").map((p) => p.memberId),
  );
  return activeMembers(cfg)
    .filter((m) => m.isTargeted && training.has(m.id) && !withTrainingTargets.has(m.id))
    .map((m) => {
      const whose = m.id === viewerMemberId ? "your" : `${m.displayName}'s`;
      const href = `/family/${m.id}#training`;
      return {
        key: `training_kcal:${m.id}`,
        kind: "training_kcal" as const,
        memberId: m.id,
        question: `On training days, should ${whose} total calories go up, or stay the same?`,
        choices: [
          {
            id: "up",
            label: "Go up",
            then: { label: "Set the training-day numbers", href },
          },
          { id: "same", label: "Stay the same" },
        ],
        more: null,
      };
    });
}

/**
 * The follow-ups the configuration leaves open, in the order they are offered (SPEC-Q-8). A
 * follow-up the configuration settles is never proposed. `viewerMemberId` is the member the
 * signed-in admin eats as, for "your" in the question.
 */
export function proposeFollowups(
  cfg: FollowupConfig,
  opts: { viewerMemberId?: string | null } = {},
): Followup[] {
  return [schoolNutFree(cfg), dinnerTime(cfg), ...trainingKcal(cfg, opts.viewerMemberId ?? null)].filter(
    (f): f is Followup => f !== null,
  );
}

export interface FollowupQueue {
  /** Today's card, or null when there is none (nothing open, or one already resolved today). */
  card: Followup | null;
  /** "QUICK QUESTION · position OF total". */
  position: number;
  total: number;
  /** The open follow-ups after today's card, in the order they will be offered. */
  upcoming: Followup[];
  answered: number;
}

/**
 * At most one card per day (SPEC-Q-9): today's card is the first open follow-up, unless one was
 * answered or dismissed today. Open = proposed and not answered; follow-ups never offered come
 * first, then dismissed ones, oldest dismissal first ("Not sure · Ask me later").
 */
export function followupQueue(
  proposed: readonly Followup[],
  states: readonly FollowupState[],
  today: string,
): FollowupQueue {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const fresh = proposed.filter((f) => !byKey.has(f.key));
  const dismissed = proposed
    .filter((f) => byKey.get(f.key)?.status === "dismissed")
    .sort((a, b) => {
      const x = byKey.get(a.key);
      const y = byKey.get(b.key);
      return (x?.resolvedAt.getTime() ?? 0) - (y?.resolvedAt.getTime() ?? 0);
    });
  const open = [...fresh, ...dismissed];
  // Answers to follow-ups the configuration no longer proposes (the answer settled them) count too.
  const answered = states.filter((s) => s.status === "answered").length;
  const resolvedToday = states.some((s) => s.resolvedOn === today);
  const card = resolvedToday ? null : (open[0] ?? null);
  return {
    card,
    position: card === null ? answered : answered + 1,
    total: answered + open.length,
    upcoming: card === null ? open : open.slice(1),
    answered,
  };
}

/**
 * The change ops of an answer, and the change set's summary. `null` ops: the answer is recorded
 * and changes nothing. Throws FollowupError for a choice the follow-up does not offer.
 */
export function followupOps(
  item: Followup,
  choice: string,
  cfg: FollowupConfig,
): { ops: ChangeOp[]; summary: string } {
  if (!item.choices.some((c) => c.id === choice))
    throw new FollowupError(`"${choice}" is not a choice of ${item.key}`);
  switch (item.kind) {
    case "school_nut_free": {
      if (choice !== "yes") return { ops: [], summary: "" };
      const ops: ChangeOp[] = schoolChildren(cfg)
        .filter((k) => !cfg.exclusions.some(
          (e) => e.kind === "dietary_flag" && e.key === NUT_FLAG && e.memberId === k.id,
        ))
        .map((k) => ({
          kind: "exclusion.add",
          payload: {
            memberId: k.id,
            kind: "dietary_flag",
            key: NUT_FLAG,
            reason: "other",
            hard: true,
          },
        }));
      return { ops, summary: "Nut-free school: no nuts for the school children" };
    }
    case "dinner_time": {
      if (choice === "yes") return { ops: [], summary: "" };
      const slot = cfg.slotTypes.find((s) => s.key === DINNER_SLOT);
      if (slot === undefined) throw new FollowupError("the household has no dinner slot");
      return {
        ops: [{ kind: "slot.update", payload: { slotTypeId: slot.id, defaultTime: `${choice}:00` } }],
        summary: `Dinner at ${choice}`,
      };
    }
    case "training_kcal":
      // Recorded only: a higher figure needs the admin's numbers (as for the carb bias, 1.4.3
      // SPEC-Q-3); "Go up" links to the member's training section.
      return { ops: [], summary: "" };
  }
}
