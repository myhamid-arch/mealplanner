// The change log and its undo (R2-ADM-7, SC-4), the configuration write path `POST /change-sets`
// (DM-6; leaf-1.4.1 SPEC-Q-1), proposals (FBK-9), the insights trigger, conversations (reads;
// the streaming POST is 1.3.5's, R-40), jobs and diagnostics (ARC-12, R-40).
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { ChangeArea } from "@mealplanner/core/changes";
import { createRepos } from "@mealplanner/db/repos";
import {
  aiGeneration,
  changeSet,
  chatMessage,
  conversation,
  dish,
  household,
  member,
  newId,
  planDay,
  planMeal,
  slotType,
  supportAccess,
  user,
  weightPreset,
} from "@mealplanner/db/schema";
import {
  applyChangeSet,
  listChangeSets,
  previewChangeSet,
  undoChangeSet,
  type UndoAvailability,
} from "@mealplanner/db/services/changes";
import { failedJobs, jobOf } from "@mealplanner/db/services/plans";
import { acceptProposal, listProposals, rejectProposal } from "@mealplanner/db/services/proposals";
import type { HouseholdContext } from "@mealplanner/core/types";
import type { CallerContext } from "../auth/context";
import { afterChangeSet } from "./followups";
import { enqueueJob } from "./jobs";
import { ProblemError, notFound } from "./problem";
import type { Runtime } from "./runtime";
import { withReadableDates } from "../../app/(app)/changelog/readable-dates";
import { iso, plain } from "./serialize";

/** Undo availability; a conflicting change is named by its resolved title when it has one (W-14). */
function undoDto(
  u: UndoAvailability,
  titles: ReadonlyMap<string, EntryDetail> = new Map(),
  year = new Date().getUTCFullYear(),
) {
  if (u.ok) return { available: true, reason: null };
  if (u.reason === "already_undone") return { available: false, reason: "Already undone" };
  const named = u.conflicts.map(
    (c) => `"${titles.get(c.changeSetId)?.title ?? withReadableDates(c.summary, year)}"`,
  );
  return {
    available: false,
    reason: `A later change touched the same settings: ${named.join(", ")}`,
  };
}

export const SUPPORT_VIEW_UNDO = "a support view changes nothing";

/** The change log, newest first, with support views merged in (R2-ADM-7, R2-ADM-8; SPEC-Q-7). */
export async function changeLog(
  rt: Runtime,
  ctx: HouseholdContext,
  q: { area?: string | undefined; limit: number },
) {
  const entries = await listChangeSets(rt.db, ctx, {
    ...(q.area === undefined || q.area === "support" ? {} : { area: q.area as ChangeArea }),
    limit: q.limit,
  });
  const details =
    q.area === "support"
      ? new Map<string, EntryDetail>()
      : await describeChangeSets(rt, ctx, [
          ...entries.map((e) => e.changeSet),
          ...(await conflictRows(rt, ctx, entries)),
        ]);
  const year = await householdYear(rt, ctx);
  for (const [id, d] of details)
    details.set(id, {
      ...d,
      title: withReadableDates(d.title, year),
      subject: withReadableDates(d.subject, year),
    });
  const changes =
    q.area === "support"
      ? []
      : entries.map((e) => ({
          type: "change_set" as const,
          id: e.changeSet.id,
          actor: e.changeSet.actor,
          actorUserId: e.changeSet.actorUserId,
          source: e.changeSet.source,
          // The stored summary, byte for byte: data for API clients (ISO dates); the screen
          // shows readable dates (CP3 round 2).
          summary: e.changeSet.summary,
          areas: e.areas,
          appliedAt: e.changeSet.appliedAt.toISOString(),
          undoneAt: iso(e.changeSet.undoneAt),
          undoneByChangeSetId: e.changeSet.undoneByChangeSetId,
          undo: undoDto(e.undo, details, year),
          ...(details.has(e.changeSet.id) ? { detail: details.get(e.changeSet.id) } : {}),
          at: e.changeSet.appliedAt,
        }));
  const views =
    q.area === undefined || q.area === "support"
      ? await rt.db
          .select({ access: supportAccess, email: user.email })
          .from(supportAccess)
          .innerJoin(user, eq(user.id, supportAccess.operatorUserId))
          .where(eq(supportAccess.householdId, ctx.householdId))
          .orderBy(desc(supportAccess.createdAt))
          .limit(q.limit)
      : [];
  const support = views.map((v) => ({
    type: "support_view" as const,
    id: v.access.id,
    operatorUserId: v.access.operatorUserId,
    operatorEmail: v.email,
    method: v.access.method,
    path: v.access.path,
    at: v.access.createdAt,
    undo: { available: false as const, reason: SUPPORT_VIEW_UNDO },
  }));
  const merged = [...changes, ...support]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, q.limit);
  return {
    entries: merged.map(({ at, ...e }) =>
      e.type === "support_view" ? { ...e, at: at.toISOString() } : e,
    ),
  };
}

// Change-log subjects (W-14, R2-ADM-7; leaf 1.4.10 SPEC-Q-7) ------------------------------------
//
// Each entry names what it changed ("Blocked Priya (kitchen)", "Sara's protein target 130 → 140 g",
// "Household settings: time zone Asia/Dubai → Europe/London") and, for scalar fields, lists the
// change's before and after values. Everything is resolved when the log is read, from the change
// set's forward ops (the new values), its inverse ops' before-images (the old values) and the
// current rows (the names), so change sets stored before this leaf need no migration.
//
// A change set gets a detail only when every forward op resolves and they all concern one subject.
// Otherwise, and whenever the subject no longer exists, the entry keeps its stored summary.

type Op = { kind: string; payload: Record<string, unknown> };
type Image = {
  entity: string;
  key: Record<string, unknown>;
  before: Record<string, unknown> | null;
};
type ChangeSetRow = typeof changeSet.$inferSelect;

export interface EntryDetail {
  title: string;
  subject: string;
  changes: Array<{ label: string; before: string | null; after: string | null }>;
}

interface Resolved extends EntryDetail {
  /** Identifies the subject across ops ("member:<id>", "household", "login:<id>" …). */
  key: string;
}

/** Names of the subjects the ops refer to, loaded once per log page. */
interface Names {
  users: Map<string, string>;
  members: Map<string, string>;
  slots: Map<string, string>;
  dishes: Map<string, string>;
  presets: Map<string, string>;
  meals: Map<string, { slot: string; date: string }>;
}

const asOps = (json: unknown): Op[] =>
  Array.isArray(json)
    ? json.flatMap((o) => {
        const op = o as { kind?: unknown; payload?: unknown } | null;
        return typeof op?.kind === "string" && typeof op.payload === "object" && op.payload !== null
          ? [{ kind: op.kind, payload: op.payload as Record<string, unknown> }]
          : [];
      })
    : [];

/** The before-images of a change set, earliest op first (undo stores them last op first). */
function imagesOf(row: Pick<ChangeSetRow, "inverse">): Image[] {
  return asOps(row.inverse)
    .reverse()
    .flatMap((op) => (op.kind === "rows.restore" ? ((op.payload.images ?? []) as Image[]) : []));
}

/** The row as it was before the change set, for the first image matching `match`. */
function beforeOf(
  images: readonly Image[],
  entity: string,
  match: (key: Record<string, unknown>, before: Record<string, unknown> | null) => boolean,
): { found: boolean; before: Record<string, unknown> | null } {
  const image = images.find((i) => i.entity === entity && match(i.key, i.before));
  return image === undefined
    ? { found: false, before: null }
    : { found: true, before: image.before };
}

const str = (v: unknown): string | null =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;

const words = (key: string) => key.replaceAll("_", " ");
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const num = (v: unknown) =>
  typeof v === "number" ? String(Math.round(v * 100) / 100) : (str(v) ?? "none");
const onOff = (v: unknown) => (v === true ? "on" : v === false ? "off" : (str(v) ?? "none"));
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A field's label and how its values read. */
type Field = { label: string; show: (v: unknown) => string };
const text: Field["show"] = (v) => str(v) ?? "none";
const enumText: Field["show"] = (v) => (typeof v === "string" ? words(v) : "none");
const grams =
  (unit: string): Field["show"] =>
  (v) =>
    v === null || v === undefined ? "none" : `${num(v)} ${unit}`;
const band =
  (unit: string): Field["show"] =>
  (v) =>
    v === null || v === undefined ? "none" : `±${num(v)} ${unit}`;

const HOUSEHOLD_FIELDS: Record<string, Field> = {
  name: { label: "name", show: text },
  locale: { label: "language", show: text },
  timezone: { label: "time zone", show: text },
  countryCode: { label: "country", show: text },
  regionNote: { label: "area", show: text },
  membersSeePlates: { label: "members see each other's plates", show: onOff },
  agentMayApply: { label: "assistant may apply changes", show: onOff },
  requireTotpForAdmins: { label: "two-step sign-in for admins", show: onOff },
  kitchenSeesNames: { label: "kitchen sees names", show: onOff },
  membersReviewForSiblings: { label: "reviews for younger siblings", show: onOff },
  insightFrequency: { label: "check-ins", show: enumText },
  defaultPrecision: { label: "default precision", show: enumText },
  satFatDefaultPct: {
    label: "sat-fat default",
    show: (v) => (v === null ? "none" : `${num(v)} %`),
  },
};
const MEMBER_FIELDS: Record<string, Field> = {
  displayName: { label: "name", show: text },
  color: { label: "colour", show: text },
  birthYear: { label: "birth year", show: text },
  sex: { label: "sex", show: enumText },
  isTargeted: { label: "follows targets", show: onOff },
  appetite: { label: "appetite", show: enumText },
  notes: { label: "notes", show: text },
};
// Chip order as ChangeLog.dc.html: the nutrients, then calories ("P 130 · 1655 kcal").
const TARGET_FIELDS: Record<string, Field> = {
  proteinG: { label: "protein", show: grams("g") },
  carbsG: { label: "carbs", show: grams("g") },
  fatG: { label: "fat", show: grams("g") },
  kcal: { label: "calories", show: grams("kcal") },
  satFatMaxG: { label: "sat fat cap", show: grams("g") },
  solubleFibreMinG: { label: "soluble fibre", show: grams("g") },
  fibreMinG: { label: "fibre", show: grams("g") },
  sodiumMaxMg: { label: "sodium cap", show: grams("mg") },
};
const TOLERANCE_FIELDS: Record<string, Field> = {
  proteinG: { label: "protein", show: band("g") },
  carbsG: { label: "carbs", show: band("g") },
  fatG: { label: "fat", show: band("g") },
  kcal: { label: "calories", show: band("kcal") },
  mode: { label: "precision", show: enumText },
};
const WEIGHT_FIELDS: Record<string, Field> = {
  macroPrecision: { label: "macro precision", show: num },
  appeal: { label: "appeal", show: num },
  ingredientEconomy: { label: "ingredient economy", show: num },
  variety: { label: "variety", show: num },
  fairness: { label: "fairness", show: num },
  aiGeneration: { label: "AI recipes", show: enumText },
  economyWindowDays: { label: "economy window", show: (v) => `${num(v)} days` },
  adjustersEnabled: { label: "adjusters", show: onOff },
  maxVariantsPerComponent: { label: "variants per component", show: num },
};
const SLOT_FIELDS: Record<string, Field> = {
  label: { label: "name", show: text },
  icon: { label: "icon", show: text },
  sortOrder: { label: "order", show: num },
  defaultTime: { label: "time", show: (v) => (typeof v === "string" ? v.slice(0, 5) : "none") },
  isShared: { label: "shared", show: onOff },
  isPacked: { label: "packed", show: onOff },
  reheatAvailable: { label: "reheat", show: onOff },
  isTrainingSlot: { label: "training slot", show: onOff },
  constraintsNote: { label: "note", show: text },
  active: { label: "in use", show: onOff },
};
const DISH_FIELDS: Record<string, Field> = {
  name: { label: "name", show: text },
  description: { label: "description", show: text },
  status: { label: "status", show: enumText },
  isPackable: { label: "packable", show: onOff },
  servedColdOk: { label: "served cold", show: onOff },
};

/** Field changes from the payload's new values and the row's before-image (scalars only). */
function fieldChanges(
  fields: Record<string, Field>,
  after: Record<string, unknown>,
  before: Record<string, unknown> | null,
): EntryDetail["changes"] {
  return Object.entries(fields).flatMap(([key, f]) => {
    if (!(key in after)) return [];
    const was = before === null ? null : f.show(before[key]);
    const now = f.show(after[key]);
    // A new row's empty optional fields are not changes worth a chip.
    if (was === now || (was === null && now === "none")) return [];
    return [{ label: f.label, before: was, after: now }];
  });
}

/** "time zone Asia/Dubai → Europe/London" for one change, or the labels for several. */
function summaryOf(changes: EntryDetail["changes"]): string {
  const [only] = changes;
  if (changes.length === 1 && only !== undefined)
    return only.before === null
      ? `${only.label} ${only.after ?? "none"}`
      : `${only.label} ${only.before} → ${only.after ?? "none"}`;
  return changes.map((c) => c.label).join(", ");
}

/** "130 → 140 g": the unit once, when both values share it. */
function arrow(before: string | null, after: string | null): string {
  if (before === null) return after ?? "none";
  const unit = /^(±?-?[\d.]+) (\S+)$/;
  const b = unit.exec(before);
  const a = after === null ? null : unit.exec(after);
  if (b !== null && a !== null && b[2] === a[2])
    return `${b[1] ?? ""} → ${a[1] ?? ""} ${b[2] ?? ""}`;
  return `${before} → ${after ?? "none"}`;
}

type Describer = (op: Op, images: readonly Image[], names: Names) => Resolved | null;

const loginOf = (op: Op, names: Names) => {
  const userId = str(op.payload.userId);
  return userId === null ? undefined : { userId, name: names.users.get(userId) };
};

const DESCRIBERS: Record<string, Describer> = {
  "access.block": (op, images, names) => {
    const login = loginOf(op, names);
    if (login?.name === undefined) return null;
    const { before } = beforeOf(images, "household_user", (k) => k.userId === login.userId);
    const role = str(before?.role);
    return {
      key: `login:${login.userId}`,
      subject: login.name,
      title: `Blocked ${login.name}${role === null ? "" : ` (${role})`}`,
      changes: [],
    };
  },
  "access.unblock": (op, images, names) => {
    const login = loginOf(op, names);
    if (login?.name === undefined) return null;
    const { before } = beforeOf(images, "household_user", (k) => k.userId === login.userId);
    const role = str(before?.role);
    return {
      key: `login:${login.userId}`,
      subject: login.name,
      title: `Unblocked ${login.name}${role === null ? "" : ` (${role})`}`,
      changes: [],
    };
  },
  "access.remove": (op, images, names) => {
    const login = loginOf(op, names);
    if (login?.name === undefined) return null;
    const { before } = beforeOf(images, "household_user", (k) => k.userId === login.userId);
    const role = str(before?.role);
    return {
      key: `login:${login.userId}`,
      subject: login.name,
      title: `Removed ${login.name}${role === null ? "" : ` (${role})`}${op.payload.archiveMember === true ? " and stopped planning their meals" : ""}`,
      changes: [],
    };
  },
  "access.link_member": (op, images, names) => {
    const login = loginOf(op, names);
    if (login?.name === undefined) return null;
    const { before } = beforeOf(images, "household_user", (k) => k.userId === login.userId);
    const was = str(before?.memberId);
    const now = str(op.payload.memberId);
    const nameOf = (id: string | null) => (id === null ? "no one" : names.members.get(id));
    const [b, a] = [nameOf(was), nameOf(now)];
    if (b === undefined || a === undefined) return null;
    return {
      key: `login:${login.userId}`,
      subject: login.name,
      title:
        now === null
          ? `${possessive(login.name)} login no longer eats as ${b}`
          : `${possessive(login.name)} login eats as ${a}`,
      changes: [{ label: "eats as", before: b, after: a }],
    };
  },
  "role.set": (op, images, names) => {
    const login = loginOf(op, names);
    if (login?.name === undefined) return null;
    const { before } = beforeOf(images, "household_user", (k) => k.userId === login.userId);
    const was = str(before?.role);
    const now = str(op.payload.role) ?? "none";
    return {
      key: `login:${login.userId}`,
      subject: login.name,
      title: `${possessive(login.name)} role ${was === null ? now : `${was} → ${now}`}`,
      changes: [{ label: "role", before: was, after: now }],
    };
  },
  "household.update": (op, images) => {
    const { before } = beforeOf(images, "household", () => true);
    const changes = fieldChanges(HOUSEHOLD_FIELDS, op.payload, before);
    if (changes.length === 0) return null;
    return {
      key: "household",
      subject: "Household settings",
      title: `Household settings: ${summaryOf(changes)}`,
      changes,
    };
  },
  "member.create": (op, _images, names) => {
    const id = str(op.payload.id);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    return { key: `member:${id}`, subject: name, title: `Added ${name}`, changes: [] };
  },
  "member.update": (op, images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    const { before } = beforeOf(images, "member", (k) => k.id === id);
    const changes = fieldChanges(MEMBER_FIELDS, op.payload, before);
    if (changes.length === 0) return null;
    return { key: `member:${id}`, subject: name, title: `${name}: ${summaryOf(changes)}`, changes };
  },
  "member.archive": (op, _images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    return {
      key: `member:${id}`,
      subject: name,
      title: `Stopped planning meals for ${name}`,
      changes: [],
    };
  },
  "target.set": (op, images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    const kind = str(op.payload.kind);
    const which = kind === "training" ? "training-day " : "";
    const { before } = beforeOf(
      images,
      "target_profile",
      (_k, b) => b !== null && b.memberId === id && b.kind === kind,
    );
    const profile = op.payload.profile as Record<string, unknown> | null;
    if (profile === null)
      return {
        key: `member:${id}`,
        subject: name,
        title: `Removed ${possessive(name)} ${which}targets`,
        changes: fieldChanges(
          TARGET_FIELDS,
          Object.fromEntries(Object.keys(TARGET_FIELDS).map((k) => [k, null])),
          before,
        ),
      };
    const changes = fieldChanges(TARGET_FIELDS, profile, before);
    // Titled by the one nutrient that changed; calories that moved with it show in the chips.
    const main = changes.filter((c) => c.label !== "calories");
    const [only] = main.length === 1 ? main : changes;
    const title =
      before === null
        ? `Set ${possessive(name)} ${which}targets`
        : (main.length === 1 || changes.length === 1) && only !== undefined
          ? `${possessive(name)} ${which}${only.label} target ${arrow(only.before, only.after)}`
          : `${possessive(name)} ${which}targets: ${summaryOf(changes)}`;
    if (changes.length === 0) return null;
    return { key: `member:${id}`, subject: name, title, changes };
  },
  "tolerance.set": (op, images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    const { before } = beforeOf(images, "tolerance", (k) => k.memberId === id);
    const changes = fieldChanges(TOLERANCE_FIELDS, op.payload, before);
    if (changes.length === 0) return null;
    const [only] = changes;
    return {
      key: `member:${id}`,
      subject: name,
      title:
        changes.length === 1 && only !== undefined
          ? `${possessive(name)} per-meal ${only.label} tolerance ${arrow(only.before, only.after)}`
          : `${possessive(name)} per-meal tolerance: ${summaryOf(changes)}`,
      changes,
    };
  },
  "training.set": (op, images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    if (id === null || name === undefined) return null;
    const dayList = (days: number[]) =>
      days.length === 0
        ? "none"
        : [...days]
            .sort((a, b) => a - b)
            .map((d) => WEEKDAY_NAMES[d] ?? String(d))
            .join(", ");
    const now = ((op.payload.days ?? []) as Array<{ weekday: number }>).map((d) => d.weekday);
    // Rows the op wrote: removed and changed ones have a before-image, added ones have none.
    const touched = images.filter((i) => i.entity === "training_schedule" && i.key.memberId === id);
    const was = new Set(now);
    for (const i of touched) {
      const day = Number(i.key.weekday);
      if (i.before === null) was.delete(day);
      else was.add(day);
    }
    const [b, a] = [dayList([...was]), dayList(now)];
    return {
      key: `member:${id}`,
      subject: name,
      title: `${possessive(name)} training days ${b === a ? a : `${b} → ${a}`}`,
      changes: [{ label: "training days", before: b, after: a }],
    };
  },
  "day_override.set": (op, _images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    const date = str(op.payload.date);
    if (id === null || name === undefined || date === null) return null;
    const slotId = str(op.payload.slotTypeId);
    const slot = slotId === null ? null : (names.slots.get(slotId) ?? undefined);
    if (slot === undefined) return null;
    const what: Record<string, string> = {
      training: "a training day",
      rest: "a rest day",
      absent_slot: `away for ${slot ?? "a meal"}`,
      extra_slot: `an extra ${slot ?? "meal"}`,
    };
    const thing = what[str(op.payload.kind) ?? ""] ?? "an exception";
    return {
      key: `member:${id}`,
      subject: name,
      title: `${name}: ${op.payload.active === true ? "" : "no longer "}${thing} on ${date}`,
      changes: [],
    };
  },
  "portion_bias.set": (op, images, names) => {
    const id = str(op.payload.memberId);
    const name = id === null ? undefined : names.members.get(id);
    const role = str(op.payload.componentRole);
    if (id === null || name === undefined || role === null) return null;
    const { before } = beforeOf(
      images,
      "portion_bias",
      (k) => k.memberId === id && k.componentRole === role,
    );
    const was = typeof before?.bias === "number" ? before.bias : 1;
    const now = typeof op.payload.bias === "number" ? op.payload.bias : 1;
    const times = (v: number) => `× ${v.toFixed(2).replace(/0$/, "")}`;
    return {
      key: `member:${id}`,
      subject: name,
      title:
        op.payload.bias === null
          ? `${possessive(name)} ${words(role)} portions back to normal`
          : `${possessive(name)} ${words(role)} portions ${times(now)}`,
      changes: [{ label: `${words(role)} portions`, before: times(was), after: times(now) }],
    };
  },
  "weights.set": (op, images) => {
    const { before } = beforeOf(images, "planning_weights", () => true);
    const changes = fieldChanges(WEIGHT_FIELDS, op.payload, before);
    if (changes.length === 0) return null;
    return {
      key: "planning",
      subject: "Planning balance",
      title: `Planning balance: ${summaryOf(changes)}`,
      changes,
    };
  },
  "preset.upsert": (op, images, names) => {
    const id = str(op.payload.id);
    const name = str(op.payload.name);
    if (name === null || (id !== null && !names.presets.has(id))) return null;
    const { before } = beforeOf(images, "weight_preset", (k) => id !== null && k.id === id);
    const values = (op.payload.values ?? {}) as Record<string, unknown>;
    const was = (before?.values ?? null) as Record<string, unknown> | null;
    const changes = fieldChanges(WEIGHT_FIELDS, values, was);
    return {
      key: `preset:${id ?? name}`,
      subject: name,
      title:
        before === null
          ? `Saved planning preset "${name}"`
          : `Planning balance: ${summaryOf(changes)} on ${name}`,
      changes,
    };
  },
  "preset.delete": (op, images) => {
    const id = str(op.payload.presetId);
    const { before } = beforeOf(images, "weight_preset", (k) => k.id === id);
    const name = str(before?.name);
    if (id === null || name === null) return null;
    return {
      key: `preset:${id}`,
      subject: name,
      title: `Deleted planning preset "${name}"`,
      changes: [],
    };
  },
  "slot.create": (op, _images, names) => {
    const id = str(op.payload.id);
    const label = id === null ? undefined : names.slots.get(id);
    if (id === null || label === undefined) return null;
    return { key: `slot:${id}`, subject: label, title: `Added the ${label} slot`, changes: [] };
  },
  "slot.update": (op, images, names) => {
    const id = str(op.payload.slotTypeId);
    const label = id === null ? undefined : names.slots.get(id);
    if (id === null || label === undefined) return null;
    const { before } = beforeOf(images, "slot_type", (k) => k.id === id);
    const changes = fieldChanges(SLOT_FIELDS, op.payload, before);
    if (changes.length === 0) return null;
    return { key: `slot:${id}`, subject: label, title: `${label}: ${summaryOf(changes)}`, changes };
  },
  "dish.update": (op, images, names) => {
    const id = str(op.payload.dishId);
    const name = id === null ? undefined : names.dishes.get(id);
    if (id === null || name === undefined) return null;
    const { before } = beforeOf(images, "dish", (k) => k.id === id);
    const changes = fieldChanges(DISH_FIELDS, op.payload, before);
    const recipe = "components" in op.payload;
    if (changes.length === 0 && !recipe) return null;
    const what = [summaryOf(changes), recipe ? "recipe" : ""].filter((x) => x !== "").join(", ");
    return { key: `dish:${id}`, subject: name, title: `${name}: ${what}`, changes };
  },
  "dish.retire": (op, _images, names) => {
    const id = str(op.payload.dishId);
    const name = id === null ? undefined : names.dishes.get(id);
    if (id === null || name === undefined) return null;
    return { key: `dish:${id}`, subject: name, title: `Retired ${name}`, changes: [] };
  },
  "plan.lock": (op, _images, names) => {
    const meal = names.meals.get(str(op.payload.planMealId) ?? "");
    if (meal === undefined) return null;
    const subject = `${meal.slot} on ${meal.date}`;
    return {
      key: `meal:${String(op.payload.planMealId)}`,
      subject,
      title: `Locked ${subject}`,
      changes: [],
    };
  },
  "plan.unlock": (op, _images, names) => {
    const meal = names.meals.get(str(op.payload.planMealId) ?? "");
    if (meal === undefined) return null;
    const subject = `${meal.slot} on ${meal.date}`;
    return {
      key: `meal:${String(op.payload.planMealId)}`,
      subject,
      title: `Unlocked ${subject}`,
      changes: [],
    };
  },
  "plan_meal.status": (op, images, names) => {
    const id = str(op.payload.planMealId);
    const meal = names.meals.get(id ?? "");
    if (id === null || meal === undefined) return null;
    const { before } = beforeOf(images, "plan_meal", (k) => k.id === id);
    const subject = `${meal.slot} on ${meal.date}`;
    const now = words(str(op.payload.status) ?? "");
    const was = str(before?.status);
    return {
      key: `meal:${id}`,
      subject,
      title: `${subject}: ${was === null ? now : `${words(was)} → ${now}`}`,
      changes: [{ label: "status", before: was === null ? null : words(was), after: now }],
    };
  },
};

/** The op kinds that get a resolved title (listed for the architect's coverage check, SPEC-Q-7). */
export const DESCRIBED_OP_KINDS: readonly string[] = Object.keys(DESCRIBERS);

/** One change set's detail, or null when it does not resolve to one existing subject. */
function describeOne(row: ChangeSetRow, names: Names): EntryDetail | null {
  const ops = asOps(row.forward);
  if (ops.length === 0) return null;
  const images = imagesOf(row);
  const resolved: Resolved[] = [];
  for (const op of ops) {
    const describe = DESCRIBERS[op.kind];
    const r = describe === undefined ? null : describe(op, images, names);
    if (r === null) return null;
    resolved.push(r);
  }
  const [first] = resolved;
  if (first === undefined || resolved.some((r) => r.key !== first.key)) return null;
  if (resolved.length === 1)
    return { title: first.title, subject: first.subject, changes: first.changes };
  return {
    title:
      resolved.length === 2
        ? resolved.map((r) => r.title).join("; ")
        : `${first.subject}: ${String(resolved.length)} changes`,
    subject: first.subject,
    changes: resolved.flatMap((r) => r.changes),
  };
}

/** Ids the ops refer to, by what they name. */
function referencedIds(rows: readonly ChangeSetRow[]) {
  const ids = {
    users: new Set<string>(),
    members: new Set<string>(),
    slots: new Set<string>(),
    dishes: new Set<string>(),
    presets: new Set<string>(),
    meals: new Set<string>(),
  };
  const add = (set: Set<string>, v: unknown) => {
    if (typeof v === "string") set.add(v);
  };
  for (const row of rows)
    for (const op of asOps(row.forward)) {
      const p = op.payload;
      add(ids.users, p.userId);
      add(ids.members, p.memberId);
      if (op.kind === "member.create") add(ids.members, p.id);
      add(ids.slots, p.slotTypeId);
      if (op.kind === "slot.create") add(ids.slots, p.id);
      add(ids.dishes, p.dishId);
      add(ids.presets, op.kind === "preset.upsert" ? p.id : p.presetId);
      add(ids.meals, p.planMealId);
    }
  return ids;
}

async function namesFor(
  rt: Runtime,
  ctx: HouseholdContext,
  rows: readonly ChangeSetRow[],
): Promise<Names> {
  const ids = referencedIds(rows);
  const hh = ctx.householdId;
  const list = (s: Set<string>) => [...s];
  const users =
    ids.users.size === 0
      ? []
      : await rt.db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, list(ids.users)));
  const members =
    ids.members.size === 0
      ? []
      : await rt.db
          .select({ id: member.id, name: member.displayName })
          .from(member)
          .where(and(eq(member.householdId, hh), inArray(member.id, list(ids.members))));
  const slots =
    ids.slots.size === 0
      ? []
      : await rt.db
          .select({ id: slotType.id, name: slotType.label })
          .from(slotType)
          .where(and(eq(slotType.householdId, hh), inArray(slotType.id, list(ids.slots))));
  const dishes =
    ids.dishes.size === 0
      ? []
      : await rt.db
          .select({ id: dish.id, name: dish.name })
          .from(dish)
          .where(and(eq(dish.householdId, hh), inArray(dish.id, list(ids.dishes))));
  const presets =
    ids.presets.size === 0
      ? []
      : await rt.db
          .select({ id: weightPreset.id, name: weightPreset.name })
          .from(weightPreset)
          .where(
            and(eq(weightPreset.householdId, hh), inArray(weightPreset.id, list(ids.presets))),
          );
  const meals =
    ids.meals.size === 0
      ? []
      : await rt.db
          .select({ id: planMeal.id, slot: slotType.label, date: planDay.date })
          .from(planMeal)
          .innerJoin(planDay, eq(planDay.id, planMeal.planDayId))
          .innerJoin(slotType, eq(slotType.id, planMeal.slotTypeId))
          .where(and(eq(planMeal.householdId, hh), inArray(planMeal.id, list(ids.meals))));
  const byId = (rs: Array<{ id: string; name: string }>) => new Map(rs.map((r) => [r.id, r.name]));
  return {
    // A deleted account keeps its row renamed "Deleted user": its subject no longer exists.
    users: byId(users.filter((u) => u.name !== "Deleted user")),
    members: byId(members),
    slots: byId(slots),
    dishes: byId(dishes),
    presets: byId(presets),
    meals: new Map(
      meals.map((m) => [
        m.id,
        { slot: m.slot, date: typeof m.date === "string" ? m.date : String(m.date) },
      ]),
    ),
  };
}

/**
 * The detail of each change set that resolves (W-14). An undo reads "Undo: <the undone entry's
 * title>", with its changes reversed.
 */
export async function describeChangeSets(
  rt: Runtime,
  ctx: HouseholdContext,
  rows: readonly ChangeSetRow[],
): Promise<Map<string, EntryDetail>> {
  const undoneBy = new Map<string, ChangeSetRow>();
  const undoIds = rows
    .filter((r) => asOps(r.forward).every((op) => op.kind === "rows.restore"))
    .map((r) => r.id);
  if (undoIds.length > 0)
    for (const undone of await rt.db
      .select()
      .from(changeSet)
      .where(
        and(
          eq(changeSet.householdId, ctx.householdId),
          inArray(changeSet.undoneByChangeSetId, undoIds),
        ),
      ))
      if (undone.undoneByChangeSetId !== null) undoneBy.set(undone.undoneByChangeSetId, undone);
  const names = await namesFor(rt, ctx, [...rows, ...undoneBy.values()]);
  const out = new Map<string, EntryDetail>();
  for (const row of rows) {
    const undone = undoneBy.get(row.id);
    if (undone !== undefined) {
      const d = describeOne(undone, names);
      if (d !== null)
        out.set(row.id, {
          title: `Undo: ${d.title}`,
          subject: d.subject,
          changes: d.changes.map((c) => ({ label: c.label, before: c.after, after: c.before })),
        });
      continue;
    }
    const d = describeOne(row, names);
    if (d !== null) out.set(row.id, d);
  }
  return out;
}

/** The current year in the household's time zone (for the dates in titles). */
async function householdYear(rt: Runtime, ctx: HouseholdContext): Promise<number> {
  const [row] = await rt.db
    .select({ timezone: household.timezone })
    .from(household)
    .where(eq(household.id, ctx.householdId));
  let timeZone = row?.timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
  } catch {
    timeZone = "UTC";
  }
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(new Date()));
}

/** The change sets that block an entry's undo and are not themselves on this page. */
async function conflictRows(
  rt: Runtime,
  ctx: HouseholdContext,
  entries: ReadonlyArray<{ changeSet: ChangeSetRow; undo: UndoAvailability }>,
): Promise<ChangeSetRow[]> {
  const listed = new Set(entries.map((e) => e.changeSet.id));
  const ids = [
    ...new Set(
      entries.flatMap((e) =>
        !e.undo.ok && e.undo.reason === "conflict"
          ? e.undo.conflicts.map((c) => c.changeSetId).filter((id) => !listed.has(id))
          : [],
      ),
    ),
  ];
  if (ids.length === 0) return [];
  return rt.db
    .select()
    .from(changeSet)
    .where(and(eq(changeSet.householdId, ctx.householdId), inArray(changeSet.id, ids)));
}

export async function changeSetOne(rt: Runtime, caller: CallerContext, id: string) {
  const row = await createRepos(rt.db, caller.ctx).change_set.get({ id });
  if (row === null) throw notFound("change set");
  return plain(row);
}

/**
 * Ops with a dedicated endpoint that adds checks around them (people and access: session
 * revocation and login lookup; support grants: operator lookup and the 168 h limit) are refused
 * here; a time zone must be a valid IANA name (the scheduler and follow-ups compute local dates).
 */
const DEDICATED_OPS: ReadonlyMap<string, string> = new Map([
  ["access.block", "POST /api/v1/access/{userId}/block"],
  ["access.unblock", "POST /api/v1/access/{userId}/unblock"],
  ["access.remove", "POST /api/v1/access/{userId}/remove"],
  ["access.link_member", "POST /api/v1/access/{userId}/link-member"],
  ["role.set", "POST /api/v1/access/{userId}/role"],
  ["support.grant", "POST /api/v1/households/current/support-grants"],
  ["support.revoke", "POST /api/v1/households/current/support-grants/{id}/revoke"],
]);

function checkOps(ops: readonly unknown[]): void {
  ops.forEach((op, index) => {
    const o = op as { kind?: unknown; payload?: { timezone?: unknown } } | null;
    const kind = typeof o?.kind === "string" ? o.kind : "";
    const endpoint = DEDICATED_OPS.get(kind);
    if (endpoint !== undefined)
      throw new ProblemError(422, "dedicated_endpoint", `${kind} is applied with ${endpoint}`, [
        { path: ["ops", index, "kind"], message: `use ${endpoint}` },
      ]);
    const tz = o?.payload?.timezone;
    if (kind === "household.update" && typeof tz === "string")
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: tz });
      } catch {
        throw new ProblemError(400, "invalid_request", "the request is invalid", [
          { path: ["ops", index, "payload", "timezone"], message: "not an IANA time zone" },
        ]);
      }
  });
}

export async function applyOps(
  rt: Runtime,
  caller: CallerContext,
  body: { summary: string; ops: unknown[] },
) {
  checkOps(body.ops);
  const applied = await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: body.summary,
    ops: body.ops,
  });
  await afterChangeSet(rt, caller.ctx.householdId, applied.changeSetId, caller.ctx.userId);
  return { changeSetId: applied.changeSetId, descriptions: applied.descriptions };
}

export async function previewOps(rt: Runtime, caller: CallerContext, ops: unknown[]) {
  checkOps(ops);
  return { descriptions: await previewChangeSet(rt.db, caller.ctx, ops) };
}

export async function undo(rt: Runtime, caller: CallerContext, id: string) {
  const result = await undoChangeSet(rt.db, caller.ctx, id, { actor: "user", source: "ui" });
  await afterChangeSet(rt, caller.ctx.householdId, result.changeSetId, caller.ctx.userId);
  return { changeSetId: result.changeSetId };
}

// Proposals --------------------------------------------------------------------------------------

export async function proposals(rt: Runtime, caller: CallerContext, status: string | undefined) {
  const rows = await listProposals(
    rt.db,
    caller.ctx,
    status === undefined ? {} : { status: status as never },
  );
  return { proposals: plain(rows) };
}

export async function accept(rt: Runtime, caller: CallerContext, id: string) {
  const result = await acceptProposal(rt.db, caller.ctx, id);
  await afterChangeSet(rt, caller.ctx.householdId, result.changeSet.changeSetId, caller.ctx.userId);
  return { proposal: plain(result.proposal), changeSetId: result.changeSet.changeSetId };
}

export async function reject(
  rt: Runtime,
  caller: CallerContext,
  id: string,
  note: string | undefined,
) {
  return { proposal: plain(await rejectProposal(rt.db, caller.ctx, id, note ?? null)) };
}

export async function runInsightsNow(rt: Runtime, caller: CallerContext) {
  const jobId = await enqueueJob(rt.db, rt.queue, {
    kind: "insights.run",
    householdId: caller.ctx.householdId,
    payload: { trigger: "on_demand" },
    createdByUserId: caller.ctx.userId,
  });
  return { jobId };
}

// Conversations (reads) --------------------------------------------------------------------------

/** An admin sees their own conversations (07 §5: the admin's conversation list). */
async function ownConversation(rt: Runtime, caller: CallerContext, id: string) {
  const row = await createRepos(rt.db, caller.ctx).conversation.get({ id });
  if (row === null || row.userId !== caller.ctx.userId) throw notFound("conversation");
  return row;
}

export async function conversations(rt: Runtime, caller: CallerContext) {
  const rows = await rt.db
    .select()
    .from(conversation)
    .where(
      and(
        eq(conversation.householdId, caller.ctx.householdId),
        eq(conversation.userId, caller.ctx.userId),
      ),
    )
    .orderBy(desc(conversation.createdAt));
  return { conversations: plain(rows) };
}

export async function createConversation(rt: Runtime, caller: CallerContext, title: string) {
  const row = {
    id: newId(),
    householdId: caller.ctx.householdId,
    userId: caller.ctx.userId,
    title,
    createdAt: new Date(),
    archivedAt: null,
  };
  await rt.db.insert(conversation).values(row);
  return plain(row);
}

export async function conversationOne(rt: Runtime, caller: CallerContext, id: string) {
  return plain(await ownConversation(rt, caller, id));
}

export async function messages(rt: Runtime, caller: CallerContext, id: string) {
  await ownConversation(rt, caller, id);
  const rows = await rt.db
    .select()
    .from(chatMessage)
    .where(
      and(eq(chatMessage.householdId, caller.ctx.householdId), eq(chatMessage.conversationId, id)),
    )
    .orderBy(asc(chatMessage.createdAt), asc(chatMessage.id));
  return { messages: plain(rows) };
}

// Jobs and diagnostics ---------------------------------------------------------------------------

export async function jobStatus(rt: Runtime, caller: CallerContext, id: string) {
  const row = await jobOf(rt.db, caller.ctx, id);
  if (row === null) throw notFound("job");
  return plain(row);
}

/** ARC-12 (R-40): the household's last 50 AI calls and its failed jobs. */
export async function diagnostics(rt: Runtime, caller: CallerContext) {
  const calls = await rt.db
    .select()
    .from(aiGeneration)
    .where(eq(aiGeneration.householdId, caller.ctx.householdId))
    .orderBy(desc(aiGeneration.createdAt))
    .limit(50);
  const failed = await failedJobs(rt.db, { householdId: caller.ctx.householdId }, 50);
  return {
    aiCalls: calls.map((c) => ({
      id: c.id,
      purpose: c.purpose,
      model: c.model,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      cacheReadTokens: c.cacheReadTokens,
      stopReason: c.stopReason,
      hasValidationErrors: c.validationErrors !== null,
      createdAt: c.createdAt.toISOString(),
    })),
    failedJobs: plain(failed),
  };
}
