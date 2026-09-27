// Slot-scoped exclusions (OQ-9, 02 §6, PLN-9 §6.3; leaf-1.2.6 SPEC-Q-4): `slot_keys` null applies
// everywhere, otherwise only in meals of those slots; an allergy is never scoped. The op stores the
// scope sorted and de-duplicated; the planner's member context is built per slot.
import { describe, expect, it } from "vitest";
import { ChangeOpSchema, getOp } from "../../../src/changes/index.js";
import { passesExclusions } from "../../../src/planner/select/filters.js";
import type { PlanDish } from "../../../src/planner/select/index.js";
import { Household } from "../../../src/planner/select/members.js";
import { Pool } from "../../../src/planner/select/pool.js";
import type { ExclusionRow, SlotTypeRow } from "../../../src/types/index.js";
import { idFactory, MemoryTx, newHousehold } from "../../onboarding/memory-tx.js";
import { f1Exclusions, f1PlanConfig, F1_WEEK } from "./f1.js";
import { seedFiles } from "./seed-files.js";
import { planF1, seedLibrary } from "./support.js";

const SCHOOL = "packed_school_lunch";
const KIDS = ["c1", "c2", "c3"];

const lib = seedLibrary();
const pool = new Pool(lib.dishes, lib.adjusters);
const dish = (id: string): PlanDish => {
  const d = lib.dishes.find((x) => x.id === id);
  if (d === undefined) throw new Error(`missing ${id}`);
  return d;
};
/** Ingredient ids carrying the nut flag, from the catalogue file (independent of the planner). */
const NUT_IDS = new Set(
  seedFiles()
    .ingredients.ingredients.filter((i) => i.dietary_flags.includes("contains_nuts"))
    .map((i) => `ing:${i.slug}`),
);

const nutFree = (memberId: string | null, slotKeys: string[] | null): ExclusionRow => ({
  id: `nuts-${memberId ?? "all"}-${slotKeys?.join("+") ?? "every"}`,
  householdId: "household-test",
  memberId,
  kind: "dietary_flag",
  key: "contains_nuts",
  reason: "other",
  hard: true,
  slotKeys,
});

function slotOf(key: string): SlotTypeRow {
  const s = f1PlanConfig().slotTypes.find((x) => x.key === key);
  if (s === undefined) throw new Error(`F1 has no slot ${key}`);
  return s;
}

describe("exclusion.add payload (OQ-9)", () => {
  const base = {
    memberId: "00000000-0000-4000-8000-000000000001",
    kind: "dietary_flag",
    key: "contains_nuts",
    reason: "other",
  };
  const parse = (payload: object) => ChangeOpSchema.safeParse({ kind: "exclusion.add", payload });

  it("defaults to every slot", () => {
    const r = parse(base);
    expect(r.success && r.data.kind === "exclusion.add" && r.data.payload.slotKeys).toBeNull();
  });
  it("stores the scope sorted and de-duplicated", () => {
    const r = parse({ ...base, slotKeys: ["snack", SCHOOL, "snack"] });
    expect(r.success && r.data.kind === "exclusion.add" && r.data.payload.slotKeys).toEqual([
      SCHOOL,
      "snack",
    ]);
  });
  it("rejects a scoped allergy, an empty scope and a malformed slot key", () => {
    expect(parse({ ...base, reason: "allergy", slotKeys: [SCHOOL] }).success).toBe(false);
    expect(parse({ ...base, reason: "allergy", slotKeys: null }).success).toBe(true);
    expect(parse({ ...base, slotKeys: [] }).success).toBe(false);
    expect(parse({ ...base, slotKeys: ["Packed Lunch"] }).success).toBe(false);
  });
  it("names the scope in the change title", () => {
    const def = getOp("exclusion.add");
    const r = parse({ ...base, slotKeys: [SCHOOL] });
    if (def === undefined || !r.success) throw new Error("exclusion.add did not parse");
    expect(def.title(r.data.payload as never)).toBe(
      `Exclude dietary flag "contains_nuts" (other) in ${SCHOOL} only`,
    );
  });
});

describe("exclusion.add apply (SPEC-Q-4)", () => {
  async function setup() {
    const tx = new MemoryTx(idFactory(7));
    await newHousehold(tx);
    const memberId = tx.newId();
    await tx.applyAll([
      {
        kind: "member.create",
        payload: {
          id: memberId,
          displayName: "Layla",
          color: "teal",
          birthYear: 2016,
          isTargeted: false,
        },
      },
    ]);
    const add = (over: object) =>
      tx.applyAll([
        {
          kind: "exclusion.add",
          payload: {
            memberId,
            kind: "dietary_flag",
            key: "contains_nuts",
            reason: "other",
            ...over,
          },
        },
      ]);
    return { tx, add };
  }

  it("writes the scope; the same exclusion with another scope is a second row", async () => {
    const { tx, add } = await setup();
    await add({ slotKeys: [SCHOOL] });
    await add({});
    const scopes = tx.rows("exclusion").map((e) => JSON.stringify(e.slotKeys));
    expect(scopes.sort()).toEqual([JSON.stringify([SCHOOL]), "null"].sort());
  });
  it("updates the row of the same scope, whatever order the keys come in", async () => {
    const { tx, add } = await setup();
    await add({ slotKeys: ["snack", SCHOOL] });
    await add({ slotKeys: [SCHOOL, "snack"], reason: "dislike", hard: false });
    const rows = tx.rows("exclusion");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slotKeys: [SCHOOL, "snack"], reason: "dislike", hard: false });
  });
  it("refuses a slot the household does not have", async () => {
    const { tx, add } = await setup();
    await expect(add({ slotKeys: ["elevenses"] })).rejects.toThrow(/no slot elevenses/);
    expect(tx.rows("exclusion")).toEqual([]);
  });
  it("refuses a scoped allergy", async () => {
    const { tx, add } = await setup();
    await expect(add({ reason: "allergy", slotKeys: [SCHOOL] })).rejects.toThrow();
    expect(tx.rows("exclusion")).toEqual([]);
  });
});

describe("the planner applies a scoped exclusion only in its slots (PLN-9 §6.3)", () => {
  // A nut dish: the seed lunch-box snack with its almonds made required and dinner added, so that
  // only the exclusion decides (seed nut components are optional, which the solver drops per plate;
  // the F1 week below covers that path).
  const seed = dish("dates-laban-almonds");
  const nutDish: PlanDish = {
    ...seed,
    slotKeys: [...seed.slotKeys, "dinner", "lunch"],
    components: seed.components.map((c) =>
      c.variants.some((v) => (pool.variant(v.id)?.core ?? []).some((i) => NUT_IDS.has(i)))
        ? { ...c, required: true }
        : c,
    ),
  };
  const withScope = (rows: ExclusionRow[]) => {
    const cfg = f1PlanConfig();
    cfg.exclusions = [...f1Exclusions(), ...rows];
    return new Household(cfg, pool);
  };
  const allowed = (hh: Household, member: string, slot: string) =>
    passesExclusions(nutDish, [hh.ctx(member, slotOf(slot), nutDish, [])]);

  it("uses a dish with a nut ingredient in every variant of a required component", () => {
    const nutComponent = nutDish.components.find(
      (c) =>
        c.required &&
        c.variants.every((v) => (pool.variant(v.id)?.core ?? []).some((i) => NUT_IDS.has(i))),
    );
    expect(nutComponent).toBeDefined();
  });
  it("refuses the nut dish in the child's packed school lunch and allows it at dinner", () => {
    const hh = withScope([nutFree("c3", [SCHOOL])]);
    expect(allowed(hh, "c3", SCHOOL)).toBe(false);
    expect(allowed(hh, "c3", "dinner")).toBe(true);
    expect(allowed(hh, "c3", "lunch")).toBe(true);
    expect(allowed(hh, "c2", SCHOOL)).toBe(true);
  });
  it("an unscoped exclusion still applies in every slot", () => {
    const hh = withScope([nutFree("c3", null)]);
    for (const s of [SCHOOL, "dinner", "lunch", "snack"]) expect(allowed(hh, "c3", s)).toBe(false);
  });
  it("a household-level scoped exclusion applies to every member in that slot only", () => {
    const hh = withScope([nutFree(null, [SCHOOL])]);
    for (const m of KIDS) {
      expect(allowed(hh, m, SCHOOL)).toBe(false);
      expect(allowed(hh, m, "dinner")).toBe(true);
    }
  });
  it("scoped and unscoped rows apply together", () => {
    const hh = withScope([nutFree("c3", [SCHOOL]), nutFree("c3", ["dinner"])]);
    expect(allowed(hh, "c3", SCHOOL)).toBe(false);
    expect(allowed(hh, "c3", "dinner")).toBe(false);
    expect(allowed(hh, "c3", "lunch")).toBe(true);
    expect(hh.exclusionsOf("c3", "lunch").dietaryFlags).not.toContain("contains_nuts");
    expect(hh.exclusionsOf("c3", SCHOOL).dietaryFlags).toContain("contains_nuts");
    // C3's sesame allergy (F1) is unscoped: it stays in both.
    expect(hh.exclusionsOf("c3", "lunch").dietaryFlags).toContain("contains_sesame");
    expect(hh.exclusionsOf("c3", SCHOOL).dietaryFlags).toContain("contains_sesame");
  });

  it("an F1 week keeps nuts out of the school children's lunch boxes", async () => {
    const cfg = f1PlanConfig();
    cfg.exclusions = [...f1Exclusions(), ...KIDS.map((k) => nutFree(k, [SCHOOL]))];
    const plan = await planF1([...F1_WEEK], { config: cfg });
    const kidPlates = plan.days.flatMap((d) =>
      d.meals.flatMap((m) =>
        m.plates.filter((p) => KIDS.includes(p.memberId)).map((p) => ({ slot: m.slotKey, p })),
      ),
    );
    const nutsIn = (slot: (s: string) => boolean) =>
      kidPlates.filter(
        ({ slot: s, p }) =>
          slot(s) &&
          [...p.solution.items, ...p.solution.adjusters].some((i) =>
            (pool.variant(i.variantId)?.core ?? []).some((x) => NUT_IDS.has(x)),
          ),
      );
    expect(kidPlates.filter((x) => x.slot === SCHOOL).length).toBeGreaterThan(0);
    expect(nutsIn((s) => s === SCHOOL)).toEqual([]);
  }, 120_000);
});
