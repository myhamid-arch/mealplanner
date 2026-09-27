// G4 support: the catalogue as the web page reads it, F1 written as five onboarding answers, F1
// expanded into ops the way `loadFixture` (packages/db) expands a fixture, and a canonical
// snapshot of the resulting configuration for comparison.
import type { ChangeOp } from "../../src/changes/index.js";
import type { InferContext, OnboardingAnswers } from "../../src/onboarding/index.js";
import { DEFAULT_SLOTS, FixtureSchema, type Fixture } from "../../src/types/index.js";
import { F1 } from "../fixtures/f1.js";
import { idFactory, MemoryTx, newHousehold } from "./memory-tx.js";

// Imported as modules through Vite's `import.meta.glob` (no runtime I/O in core, ARC-3), as in
// test/planner/select/seed-files.ts.
declare global {
  interface ImportMeta {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the JSON shape at the call site
    glob<T>(pattern: string, options: { eager: true }): Record<string, { default: T }>;
  }
}

function dataFile<T>(files: Record<string, { default: T }>, name: string): T {
  const value = Object.values(files)[0]?.default;
  if (value === undefined) throw new Error(`data file ${name} not found`);
  return value;
}

interface IngredientFileRow {
  slug: string;
  name: string;
  aliases: string[];
  dietary_flags: string[];
}

export type CatalogueIngredient = InferContext["ingredients"][number];

export function catalogueIngredients(): CatalogueIngredient[] {
  const file = dataFile(
    import.meta.glob<{ ingredients: IngredientFileRow[] }>("../../../../data/ingredients.v1.json", {
      eager: true,
    }),
    "ingredients.v1.json",
  );
  return file.ingredients.map((i) => ({
    slug: i.slug,
    name: i.name,
    aliases: i.aliases,
    dietaryFlags: i.dietary_flags,
  }));
}

export function catalogueCuisines(): { key: string; label: string }[] {
  return dataFile(
    import.meta.glob<{ key: string; label: string }[]>("../../../../data/cuisines.json", {
      eager: true,
    }),
    "cuisines.json",
  ).map((c) => ({ key: c.key, label: c.label }));
}

export const REFERENCE_YEAR = 2026;

/**
 * F1 (11-build-plan §2) as the five answers an admin would give. Question 5 names only C3's
 * sesame allergy, the one exclusion F1 has.
 */
export const F1_TEXT = {
  people: "Adult A 40, Adult B 37, Child C1 18 F, Child C2 15 M, Child C3 10 M",
  targets: {
    "Adult A":
      "2150 cal, 180p 200c 70f, sat fat 22g, soluble fibre 10g. Training days: 2390 / 180 / 260 / 70, sat fat 22g, soluble fibre 10g",
    "Adult B": "1655 / 130 / 160 / 55, sat fat max 18 g",
  },
  neverEat: "Child C3 is allergic to sesame.",
} as const;

export const F1_WEEK: NonNullable<OnboardingAnswers["week"]> = {
  school: { people: ["Child C1", "Child C2", "Child C3"], weekdays: [0, 1, 2, 3, 4] },
  work: { people: ["Adult A"], weekdays: [0, 1, 2, 3, 4] },
  training: [
    { person: "Adult A", weekdays: [0, 2, 4], time: "evening" },
    { person: "Adult B", weekdays: [1, 3, 5], time: "morning" },
  ],
  snacks: true,
};

export const F1_CUISINES = ["italian", "levantine", "american", "british", "indian"];

export function context(
  slotIds: Record<string, string>,
  overrides: Partial<InferContext> = {},
): InferContext {
  return {
    referenceYear: REFERENCE_YEAR,
    adminName: "Adult A",
    slots: DEFAULT_SLOTS.map((s) => ({
      id: slotIds[s.key] ?? "",
      key: s.key,
      label: s.label,
      active: s.active,
    })),
    cuisines: catalogueCuisines(),
    ingredients: catalogueIngredients(),
    satFatDefaultPct: 6,
    newId: idFactory(7),
    ...overrides,
  };
}

/** F1's configuration as `loadFixture` builds it (packages/db/src/services/config/fixtures.ts). */
export function fixtureOps(
  input: typeof F1,
  slotIds: Record<string, string>,
  newId: () => string,
): ChangeOp[] {
  const fixture: Fixture = FixtureSchema.parse(input);
  const members: Record<string, string> = {};
  for (const m of fixture.members) members[m.key] = newId();
  const id = (map: Record<string, string>, key: string): string => {
    const v = map[key];
    if (v === undefined) throw new Error(`unknown key ${key}`);
    return v;
  };
  const ops: ChangeOp[] = [];
  for (const m of fixture.members) {
    const memberId = id(members, m.key);
    ops.push({
      kind: "member.create",
      payload: {
        id: memberId,
        displayName: m.displayName,
        color: m.color,
        birthYear: m.birthYear ?? null,
        sex: m.sex ?? null,
        isTargeted: m.targets !== undefined,
        appetite: m.appetite,
      },
    });
    if (m.targets !== undefined) {
      ops.push({
        kind: "target.set",
        payload: { memberId, kind: "default", profile: m.targets.default },
      });
      if (m.targets.training !== undefined)
        ops.push({
          kind: "target.set",
          payload: { memberId, kind: "training", profile: m.targets.training },
        });
    }
    if (m.tolerance !== undefined)
      ops.push({ kind: "tolerance.set", payload: { memberId, ...m.tolerance } });
    if (m.training.length > 0)
      ops.push({
        kind: "training.set",
        payload: {
          memberId,
          days: m.training.map((d) => ({
            weekday: d.weekday,
            sessionTime: d.sessionTime,
            intensity: d.intensity ?? null,
          })),
        },
      });
  }
  const active = new Set(fixture.slots.active);
  for (const slot of DEFAULT_SLOTS)
    if (slot.active !== active.has(slot.key))
      ops.push({
        kind: "slot.update",
        payload: { slotTypeId: id(slotIds, slot.key), active: active.has(slot.key) },
      });
  for (const s of fixture.schedules)
    ops.push({
      kind: "slot_schedule.set",
      payload: {
        memberId: id(members, s.member),
        slotTypeId: id(slotIds, s.slot),
        days: s.weekdays.map((weekday) => ({ weekday, attends: s.attends })),
      },
    });
  for (const [keys, score] of [
    [fixture.cuisines.liked, 0.5],
    [fixture.cuisines.disliked, -0.5],
  ] as const)
    for (const key of keys)
      ops.push({
        kind: "preference.set",
        payload: {
          memberId: null,
          entityType: "cuisine",
          entityKey: key,
          score,
          source: "explicit",
        },
      });
  for (const e of fixture.exclusions)
    ops.push({
      kind: "exclusion.add",
      payload: {
        memberId: e.member === undefined ? null : id(members, e.member),
        kind: e.kind,
        key: e.key,
        reason: e.reason,
        hard: true,
      },
    });
  return ops;
}

/** A configuration with ids replaced by member names and slot keys, in a stable order. */
export interface Snapshot {
  members: Record<string, Record<string, unknown>>;
  targets: string[];
  tolerances: string[];
  training: string[];
  slots: Record<string, Record<string, unknown>>;
  schedules: string[];
  preferences: string[];
  exclusions: string[];
  distributions: number;
  slotTargets: number;
}

export function snapshot(tx: MemoryTx): Snapshot {
  const memberName = new Map(tx.rows("member").map((m) => [m.id, m.displayName]));
  const slotKey = new Map(tx.rows("slot_type").map((s) => [s.id, s.key]));
  const who = (id: string | null) => (id === null ? "*" : (memberName.get(id) ?? `?${id}`));
  const line = (o: Record<string, unknown>) => JSON.stringify(o);
  return {
    members: Object.fromEntries(
      tx.rows("member").map((m) => [
        m.displayName,
        {
          birthYear: m.birthYear,
          sex: m.sex,
          isTargeted: m.isTargeted,
          appetite: m.appetite,
          color: m.color,
          notes: m.notes,
          archivedAt: m.archivedAt,
        },
      ]),
    ),
    targets: tx
      .rows("target_profile")
      .map((t) =>
        line({
          member: who(t.memberId),
          kind: t.kind,
          kcal: t.kcal,
          proteinG: t.proteinG,
          carbsG: t.carbsG,
          fatG: t.fatG,
          satFatMaxG: t.satFatMaxG,
          solubleFibreMinG: t.solubleFibreMinG,
          fibreMinG: t.fibreMinG,
          sodiumMaxMg: t.sodiumMaxMg,
        }),
      )
      .sort(),
    tolerances: tx
      .rows("tolerance")
      .map((t) =>
        line({
          member: who(t.memberId),
          p: t.proteinG,
          c: t.carbsG,
          f: t.fatG,
          kcal: t.kcal,
          mode: t.mode,
        }),
      )
      .sort(),
    training: tx
      .rows("training_schedule")
      .map((t) =>
        line({
          member: who(t.memberId),
          weekday: t.weekday,
          time: t.sessionTime,
          intensity: t.intensity,
        }),
      )
      .sort(),
    slots: Object.fromEntries(
      tx.rows("slot_type").map((s) => [
        s.key,
        {
          active: s.active,
          isShared: s.isShared,
          isPacked: s.isPacked,
          reheatAvailable: s.reheatAvailable,
          isTrainingSlot: s.isTrainingSlot,
          defaultTime: s.defaultTime,
          constraintsNote: s.constraintsNote,
        },
      ]),
    ),
    schedules: tx
      .rows("member_slot_schedule")
      .map(
        (s) =>
          `${who(s.memberId)}|${slotKey.get(s.slotTypeId) ?? "?"}|${String(s.weekday)}|${String(s.attends)}`,
      )
      .sort(),
    preferences: tx
      .rows("preference")
      .map((p) =>
        line({
          member: who(p.memberId),
          type: p.entityType,
          key: p.entityKey,
          score: p.score,
          source: p.source,
          locked: p.locked,
          hard: p.hard,
        }),
      )
      .sort(),
    exclusions: tx
      .rows("exclusion")
      .map((e) =>
        line({ member: who(e.memberId), kind: e.kind, key: e.key, reason: e.reason, hard: e.hard }),
      )
      .sort(),
    distributions: tx.rows("meal_distribution").length,
    slotTargets: tx.rows("slot_target_override").length,
  };
}

/** The F1 configuration, built from the fixture itself. */
export async function f1Snapshot(): Promise<Snapshot> {
  const tx = new MemoryTx(idFactory(1));
  const slotIds = await newHousehold(tx);
  await tx.applyAll(fixtureOps(F1, slotIds, tx.newId));
  return snapshot(tx);
}

/** Every difference between two snapshots, as readable lines. Empty when equal. */
export function diffSnapshots(expected: Snapshot, actual: Snapshot): string[] {
  const out: string[] = [];
  for (const section of Object.keys(expected) as (keyof Snapshot)[]) {
    const e = expected[section];
    const a = actual[section];
    if (Array.isArray(e) && Array.isArray(a)) {
      for (const x of e) if (!a.includes(x)) out.push(`${section}: missing ${x}`);
      for (const x of a) if (!e.includes(x)) out.push(`${section}: unexpected ${x}`);
    } else if (typeof e === "object" && typeof a === "object") {
      const keys = new Set([...Object.keys(e), ...Object.keys(a)]);
      for (const k of keys) {
        const ev = JSON.stringify((e as Record<string, unknown>)[k]);
        const av = JSON.stringify((a as Record<string, unknown>)[k]);
        if (ev !== av) out.push(`${section}.${k}: expected ${ev}, got ${av}`);
      }
    } else if (e !== a) {
      out.push(`${section}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
    }
  }
  return out;
}
