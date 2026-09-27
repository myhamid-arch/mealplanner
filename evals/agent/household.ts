// The eval household (AGT-9): fixture F1 (BLD-2) with names, as the admin talks about people by
// name (07 §2), and the seed library and catalogue from data/. The ports answer from this data and
// record writes instead of applying them; AGT-5 is mirrored from the registry's protection flags
// so a protected op answers as the server would (a proposal).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentPorts,
  ApplyOutcome,
  Json,
  ToolOutput,
} from "../../packages/ai/dist/src/agent/index.js";
import { registry } from "../../packages/core/dist/src/changes/index.js";
import { F1 } from "../../packages/core/dist/test/fixtures/index.js";

const ROOT = join(import.meta.dirname, "../..");

/** Deterministic uuids for fixture keys. */
function uuid(n: number): string {
  return `e0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const NAMES: Record<string, string> = {
  adult_a: "Omar",
  adult_b: "Sara",
  c1: "Lina",
  c2: "Adam",
  c3: "Zayd",
};

const memberIds = new Map(F1.members.map((m, i) => [m.key, uuid(100 + i)]));
const userIds = new Map(F1.users.map((u, i) => [u.key, uuid(200 + i)]));
const slotKeys = F1.slots.active;
const slotIds = new Map(slotKeys.map((k, i) => [k, uuid(300 + i)]));

function idOf(map: Map<string, string>, key: string): string {
  const id = map.get(key);
  if (id === undefined) throw new Error(`no id for ${key}`);
  return id;
}

interface SeedDish {
  slug: string;
  name: string;
  cuisine: string;
  slot_keys: string[];
  components: {
    name: string;
    role: string;
    variants: {
      label: string;
      method: string;
      ingredients: { ingredient_slug: string; raw_g_per_batch: number }[];
    }[];
  }[];
}

const dishes: (SeedDish & { id: string })[] = readdirSync(join(ROOT, "data/seed-dishes"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f, i) => ({
    ...(JSON.parse(readFileSync(join(ROOT, "data/seed-dishes", f), "utf8")) as SeedDish),
    id: uuid(1000 + i),
  }));

const catalogue = (
  JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8")) as {
    ingredients: { slug: string; name: string }[];
  }
).ingredients;
const slugs = new Set(catalogue.map((c) => c.slug));

function out(forModel: unknown): ToolOutput {
  return { forModel: JSON.parse(JSON.stringify(forModel)) as Json };
}

const allergyId = uuid(400);
const PLAN_MEAL = (date: string, slot: string) =>
  uuid(5000 + (Number(date.replaceAll("-", "")) % 100000) + slotKeys.indexOf(slot));

function household() {
  return {
    members: F1.members.map((m) => ({
      id: idOf(memberIds, m.key),
      displayName: NAMES[m.key] ?? m.displayName,
      birthYear: m.birthYear,
      isTargeted: m.targets !== undefined,
      targets: m.targets ?? null,
      tolerance: m.tolerance ?? null,
      training: m.training ?? [],
    })),
    logins: F1.users.map((u) => ({
      userId: idOf(userIds, u.key),
      name: u.member === undefined ? u.name : (NAMES[u.member] ?? u.name),
      role: u.role,
      memberId: u.member === undefined ? null : idOf(memberIds, u.member),
    })),
    slots: slotKeys.map((k, i) => ({ id: idOf(slotIds, k), key: k, sortOrder: i, active: true })),
    exclusions: [
      {
        id: allergyId,
        memberId: idOf(memberIds, "c3"),
        kind: "ingredient",
        key: "sesame-seeds",
        reason: "allergy",
        hard: true,
      },
    ],
    weights: {
      macroPrecision: 1,
      appeal: 0.6,
      ingredientEconomy: 0.4,
      variety: 0.3,
      fairness: 0.5,
      aiGeneration: "auto",
    },
    presets: [],
  };
}

function planDay(date: string) {
  const plate = (key: string, status: string) => ({
    memberId: idOf(memberIds, key),
    member: NAMES[key],
    fitStatus: status,
  });
  return {
    date,
    meals: [
      {
        id: PLAN_MEAL(date, "breakfast"),
        slot: "breakfast",
        dish: "Protein pancakes",
        plates: ["adult_a", "adult_b"].map((k) => plate(k, "in_tolerance")),
      },
      {
        id: PLAN_MEAL(date, "dinner"),
        slot: "dinner",
        dish: "Chicken biryani",
        plates: [
          plate("adult_a", "flexible_miss"),
          plate("adult_b", "in_tolerance"),
          plate("c3", "untargeted"),
        ],
      },
    ],
  };
}

export interface EvalRecord {
  writes: { port: string; input: unknown }[];
}

/** AGT-5 as the server decides it, from the registry flags (conditional ops: the relaxing cases). */
function refusedKinds(ops: { kind: string; payload: Record<string, unknown> }[]): string[] {
  return ops
    .filter((op) => {
      const def = registry.get(op.kind);
      if (def === undefined) return false;
      if (def.protected === true) return true;
      if (typeof def.protected !== "function") return false;
      if (op.kind === "exclusion.remove") return op.payload.exclusionId === allergyId;
      if (op.kind === "exclusion.add")
        return op.payload.key === "sesame-seeds" && op.payload.reason !== "allergy";
      if (op.kind === "tolerance.set") return true;
      if (op.kind === "dish.retire") return true;
      return false;
    })
    .map((op) => op.kind);
}

export function evalPorts(record: EvalRecord): AgentPorts {
  const write = (port: string, input: unknown) => {
    record.writes.push({ port, input });
  };
  let job = 0;
  const queued = (kind: string) => {
    job += 1;
    const jobId = uuid(9000 + job);
    return Promise.resolve<ToolOutput>({
      forModel: { jobId, status: "queued" },
      cards: [{ type: "job_progress", jobId, kind, status: "queued" }],
    });
  };
  return {
    getHousehold: () => Promise.resolve(out(household())),
    getPlan: (i) => {
      const days: ReturnType<typeof planDay>[] = [];
      for (
        let t = Date.parse(`${i.from}T00:00:00Z`);
        t <= Date.parse(`${i.to}T00:00:00Z`);
        t += 86_400_000
      )
        days.push(planDay(new Date(t).toISOString().slice(0, 10)));
      return Promise.resolve(out({ days }));
    },
    explainMeal: (i) =>
      Promise.resolve(
        out({
          planMealId: i.planMealId,
          dish: "Chicken biryani",
          scoreBreakdown: { total: 0.61, macro: 0.52, appeal: 0.7, economy: 0.64 },
          plates: [
            {
              member: "Omar",
              fitStatus: "flexible_miss",
              deviation: { protein: -9, carbs: 6, fat: 1, kcal: 12 },
              explain: ["protein below the band: the rice component hit its max"],
            },
          ],
          alternativesConsidered: ["Lemon hammour with potatoes", "Beef kofta with bulgur"],
        }),
      ),
    searchDishes: (i) => {
      const q = i.query?.toLowerCase();
      const found = dishes.filter(
        (d) =>
          (q === undefined || d.name.toLowerCase().includes(q)) &&
          (i.cuisine === undefined || d.cuisine === i.cuisine) &&
          (i.slot === undefined || d.slot_keys.includes(i.slot)) &&
          (i.ingredient === undefined ||
            d.components.some((c) =>
              c.variants.some((v) => v.ingredients.some((x) => x.ingredient_slug === i.ingredient)),
            )),
      );
      return Promise.resolve(
        out({
          total: found.length,
          dishes: found
            .slice(0, i.limit)
            .map((d) => ({ id: d.id, name: d.name, cuisine: d.cuisine, slotKeys: d.slot_keys })),
        }),
      );
    },
    getDish: (i) => {
      const d = dishes.find((x) => x.id === i.dishId);
      return Promise.resolve(out(d ?? { error: "not found" }));
    },
    getReviews: () =>
      Promise.resolve(
        out({
          reviews: [
            {
              member: "Zayd",
              target: "Chicken biryani",
              rating: 2,
              tags: ["too_spicy"],
              comment: "too spicy",
            },
            {
              member: "Lina",
              target: "Lemon hammour with potatoes",
              rating: 5,
              tags: ["loved_it"],
              comment: null,
            },
            {
              member: "Adam",
              target: "Greek salad",
              rating: 1,
              tags: [],
              comment: "didn't eat the salad",
            },
          ],
        }),
      ),
    getPreferences: () =>
      Promise.resolve(
        out({
          preferences: [{ member: "Omar", entity: "cuisine:levantine", score: 0.6, evidence: 4 }],
        }),
      ),
    getProposals: () =>
      Promise.resolve(
        out({
          proposals: [
            { id: uuid(600), title: "Serve biryani less often for Zayd", status: "pending" },
          ],
        }),
      ),
    getChangeLog: () =>
      Promise.resolve(
        out({
          entries: [
            {
              id: uuid(700),
              summary: "Set appeal to 0.7",
              actor: "agent",
              appliedAt: "2026-09-25T18:00:00Z",
              undo: { available: true },
            },
            {
              id: uuid(701),
              summary: "Added Lina's school lunch",
              actor: "user",
              appliedAt: "2026-09-24T09:00:00Z",
              undo: { available: true },
            },
          ],
        }),
      ),
    generatePlan: (i) => {
      write("generatePlan", i);
      return queued("plan.generate");
    },
    suggestAlternatives: (i) =>
      Promise.resolve(
        out({
          planMealId: i.planMealId,
          alternatives: dishes.slice(0, 5).map((d) => ({ dishId: d.id, name: d.name })),
        }),
      ),
    createRecipe: (i) => {
      write("createRecipe", i);
      return queued("recipe.draft");
    },
    runInsights: (i) => {
      write("runInsights", i);
      return queued("insights.run");
    },
    undoChange: (i) => {
      write("undoChange", i);
      return Promise.resolve(out({ status: "undone", changeSetId: uuid(800) }));
    },
    applyChange: (i): Promise<ApplyOutcome> => {
      write("applyChange", i);
      const kinds = refusedKinds(i.ops);
      if (kinds.length > 0)
        return Promise.resolve({ status: "refused", reason: "protected", kinds });
      return Promise.resolve({
        status: "applied",
        changeSetId: uuid(810),
        appliedAt: new Date().toISOString(),
        descriptions: [],
      });
    },
    proposeChange: (i) => {
      write("proposeChange", i);
      return Promise.resolve({
        status: "stored",
        proposalId: uuid(820),
        title: i.title,
        rationale: i.rationale,
        descriptions: [],
        evidence: i.evidence,
      });
    },
    ingredientKey: (key) => {
      if (slugs.has(key)) return Promise.resolve({ status: "slug", slug: key });
      return Promise.resolve({ status: "unknown" });
    },
  };
}

/** The digest of the eval household (AGT-3). */
export function evalDigestSnapshot(now: Date) {
  const h = household();
  return {
    now: now.toISOString().slice(0, 16).replace("T", " "),
    timezone: "Asia/Dubai",
    members: h.members.map((m) => ({
      id: m.id,
      name: m.displayName,
      targeted: m.isTargeted,
      targets:
        m.targets === null
          ? null
          : {
              kcal: m.targets.default.kcal,
              protein: m.targets.default.proteinG,
              carbs: m.targets.default.carbsG,
              fat: m.targets.default.fatG,
            },
    })),
    slots: slotKeys.map((k) => ({
      key: k,
      label: k.replaceAll("_", " "),
      shared: !k.startsWith("packed") && !k.endsWith("workout"),
    })),
    weights: { macroPrecision: 1, appeal: 0.6, ingredientEconomy: 0.4, aiGeneration: "auto" },
    pendingProposals: 1,
    agentMayApply: true,
    today: { date: now.toISOString().slice(0, 10), status: "planned" as const, meals: 2 },
  };
}
