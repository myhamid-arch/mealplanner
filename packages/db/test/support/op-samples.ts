// Sample payloads for every public op, generated from the current state of a populated fixture
// household with a seeded PRNG (the G3 property test). Each sample is a real change of that state.
import type { ChangeOp, ChangeOpKind } from "@mealplanner/core/changes";
import { createRepos, type Executor } from "../../src/repos/index.js";
import { readCatalogIds } from "../../src/services/config/index.js";
import type { FixtureHousehold } from "./fixtures.js";
import { must } from "./must.js";

export type Random = () => number;

export function prng(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[], what: string): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error(`no ${what} to pick from`);
  return item;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const tag = (random: Random) => Math.floor(random() * 1e9).toString(36);

type Generator = (random: Random) => ChangeOp | Promise<ChangeOp>;

/** One generator per public op kind; each returns a payload valid against the current state. */
export function opGenerators(
  db: Executor,
  household: FixtureHousehold,
): Record<ChangeOpKind, Generator> {
  const ctx = household.loaded.adminContext;
  const repos = () => createRepos(db, ctx);
  const { populated } = household;
  const members = async () => (await repos().member.list()).filter((m) => m.archivedAt === null);
  const slots = async () => repos().slot_type.list();
  const nonAdminLogins = async () =>
    (await repos().household_user.list()).filter((l) => l.role !== "admin");
  const futureDate = (random: Random) =>
    `2027-0${String(1 + Math.floor(random() * 9))}-1${String(Math.floor(random() * 9))}`;
  const catalog = () => readCatalogIds(db);

  return {
    "household.update": (r) => ({
      kind: "household.update",
      payload: {
        name: `Household ${tag(r)}`,
        satFatDefaultPct: round2(5 + r() * 10),
        regionNote: r() < 0.5 ? null : "Al Reem",
      },
    }),
    "member.create": (r) => ({
      kind: "member.create",
      payload: {
        displayName: `New ${tag(r)}`,
        color: "basil",
        isTargeted: r() < 0.5,
        birthYear: 1970 + Math.floor(r() * 40),
        appetite: pick(r, ["small", "medium", "large"] as const, "appetite"),
      },
    }),
    "member.update": async (r) => {
      const m = pick(r, await members(), "member");
      return {
        kind: "member.update",
        payload: {
          memberId: m.id,
          displayName: `${m.displayName} ${tag(r)}`,
          appetite: m.appetite === "large" ? "small" : "large",
        },
      };
    },
    "member.archive": async (r) => ({
      kind: "member.archive",
      payload: { memberId: pick(r, await members(), "member").id },
    }),
    "target.set": async (r) => {
      const targeted = (await members()).filter((m) => m.isTargeted);
      const m = pick(r, targeted, "targeted member");
      const training = await repos().target_profile.list({ memberId: m.id, kind: "training" });
      if (training.length > 0 && r() < 0.5)
        return { kind: "target.set", payload: { memberId: m.id, kind: "training", profile: null } };
      return {
        kind: "target.set",
        payload: {
          memberId: m.id,
          kind: r() < 0.5 ? "default" : "training",
          profile: {
            kcal: 1800 + Math.floor(r() * 900),
            proteinG: 120 + Math.floor(r() * 80),
            carbsG: 150 + Math.floor(r() * 150),
            fatG: 50 + Math.floor(r() * 30),
            satFatMaxG: 20,
          },
        },
      };
    },
    "tolerance.set": async (r) => ({
      kind: "tolerance.set",
      payload: {
        memberId: pick(r, await members(), "member").id,
        proteinG: 1 + Math.floor(r() * 9),
        kcal: 20 + Math.floor(r() * 80),
      },
    }),
    "training.set": async (r) => {
      const m = pick(r, await members(), "member");
      const days = [0, 1, 2, 3, 4, 5, 6]
        .filter(() => r() < 0.4)
        .map((weekday) => ({ weekday, sessionTime: "06:15:00", intensity: "hard" as const }));
      return {
        kind: "training.set",
        payload: {
          memberId: m.id,
          days:
            days.length > 0
              ? days
              : [{ weekday: 6, sessionTime: "09:45:00", intensity: "light" as const }],
        },
      };
    },
    "day_override.set": async (r) => {
      const existing = await repos().day_override.list();
      const row = existing[0];
      if (row !== undefined && r() < 0.5)
        return {
          kind: "day_override.set",
          payload: {
            memberId: row.memberId,
            date: row.date,
            kind: row.kind,
            slotTypeId: row.slotTypeId,
            active: false,
          },
        };
      return {
        kind: "day_override.set",
        payload: {
          memberId: pick(r, await members(), "member").id,
          date: futureDate(r),
          kind: r() < 0.5 ? "rest" : "training",
          slotTypeId: null,
          active: true,
        },
      };
    },
    "slot.create": (r) => ({
      kind: "slot.create",
      payload: {
        key: `custom_${tag(r)}`,
        label: "Custom slot",
        icon: "star",
        sortOrder: 70,
        defaultTime: "21:00:00",
        isShared: r() < 0.5,
        isPacked: false,
        reheatAvailable: false,
        isTrainingSlot: false,
        active: true,
      },
    }),
    "slot.update": async (r) => {
      const s = pick(r, await slots(), "slot");
      return {
        kind: "slot.update",
        payload: { slotTypeId: s.id, label: `${s.label} ${tag(r)}`, active: !s.active },
      };
    },
    "slot_schedule.set": async (r) => {
      const m = pick(r, await members(), "member");
      const s = pick(r, await slots(), "slot");
      const rows = await repos().member_slot_schedule.list({ memberId: m.id, slotTypeId: s.id });
      const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
        const row = rows.find((x) => x.weekday === weekday);
        return {
          weekday,
          attends: row === undefined ? r() < 0.5 : r() < 0.3 ? null : !row.attends,
        };
      });
      return { kind: "slot_schedule.set", payload: { memberId: m.id, slotTypeId: s.id, days } };
    },
    "distribution.set": async (r) => {
      const existing = await repos().meal_distribution.list();
      const row = existing[0];
      if (row !== undefined && r() < 0.4)
        return {
          kind: "distribution.set",
          payload: { memberId: row.memberId, dayKind: row.dayKind, shares: null },
        };
      const all = await slots();
      const bySlot = (key: string) => must(all.find((s) => s.key === key)).id;
      const first = round2(0.2 + r() * 0.3);
      return {
        kind: "distribution.set",
        payload: {
          memberId: pick(r, await members(), "member").id,
          dayKind: "training",
          shares: [
            { slotTypeId: bySlot("breakfast"), share: first },
            { slotTypeId: bySlot("dinner"), share: round2(1 - first) },
          ],
        },
      };
    },
    "slot_target.set": async (r) => ({
      kind: "slot_target.set",
      payload: {
        memberId: pick(r, await members(), "member").id,
        dayKind: "training",
        slotTypeId: pick(r, await slots(), "slot").id,
        values: { kcal: 400 + Math.floor(r() * 400), fatG: 10 + Math.floor(r() * 20) },
      },
    }),
    "weights.set": (r) => ({
      kind: "weights.set",
      payload: {
        appeal: round2(r()),
        variety: round2(r()),
        aiGeneration: pick(r, ["auto", "ask", "off"] as const, "mode"),
      },
    }),
    "preset.upsert": async (r) => {
      const presets = await repos().weight_preset.list();
      const existing = presets[0];
      if (existing !== undefined && r() < 0.5)
        return {
          kind: "preset.upsert",
          payload: {
            id: existing.id,
            name: `${existing.name} ${tag(r)}`,
            values: { appeal: round2(r()) },
            appliesToWeekdays: null,
          },
        };
      return {
        kind: "preset.upsert",
        payload: {
          name: `Preset ${tag(r)}`,
          values: { ingredientEconomy: round2(r()) },
          appliesToWeekdays: [0, 4],
        },
      };
    },
    "preset.delete": async (r) => ({
      kind: "preset.delete",
      payload: { presetId: pick(r, await repos().weight_preset.list(), "preset").id },
    }),
    "preference.set": async (r) => {
      const m = r() < 0.5 ? null : pick(r, await members(), "member").id;
      return {
        kind: "preference.set",
        payload: {
          memberId: m,
          entityType: "cuisine",
          entityKey: pick(r, ["italian", "indian", "greek", "japanese"], "cuisine"),
          score: round2(r() * 2 - 1),
          locked: r() < 0.3,
        },
      };
    },
    "preference.reset": async (r) => {
      const p = pick(r, await repos().preference.list(), "preference");
      return {
        kind: "preference.reset",
        payload: { memberId: p.memberId, entityType: p.entityType, entityKey: p.entityKey },
      };
    },
    "exclusion.add": async (r) => ({
      kind: "exclusion.add",
      payload: {
        memberId: pick(r, await members(), "member").id,
        kind: "ingredient",
        key: `ingredient_${tag(r)}`,
        reason: pick(r, ["dislike", "allergy", "medical"] as const, "reason"),
      },
    }),
    "exclusion.remove": async (r) => ({
      kind: "exclusion.remove",
      payload: { exclusionId: pick(r, await repos().exclusion.list(), "exclusion").id },
    }),
    "frequency.set": async (r) => {
      const existing = (await repos().frequency_rule.list())[0];
      if (existing !== undefined && r() < 0.4)
        return {
          kind: "frequency.set",
          payload: {
            memberId: existing.memberId,
            entityType: existing.entityType,
            entityKey: existing.entityKey,
            minGapDays: null,
            maxPerWeek: null,
          },
        };
      return {
        kind: "frequency.set",
        payload: {
          memberId: null,
          entityType: "dish",
          entityKey: populated.dishId,
          minGapDays: 1 + Math.floor(r() * 14),
          maxPerWeek: null,
          locked: true,
        },
      };
    },
    "adjusters.set": (r) =>
      r() < 0.5
        ? { kind: "adjusters.set", payload: { enabled: false } }
        : {
            kind: "adjusters.set",
            payload: { dishes: [{ dishId: populated.adjusterDishId, enabled: false }] },
          },
    "dish.create": async (r) => {
      const c = await catalog();
      return {
        kind: "dish.create",
        payload: {
          name: `Dish ${tag(r)}`,
          slug: `dish_${tag(r)}`,
          description: "Generated.",
          cuisineId: must(c.cuisines.get("italian")),
          slotKeys: ["dinner"],
          isPackable: r() < 0.5,
          servedColdOk: false,
          components: [
            {
              name: "Pasta",
              role: "carb",
              portioning: "continuous",
              minServingG: 0,
              maxServingG: 300,
              defaultServingG: 150,
              required: true,
              variants: [
                {
                  methodId: must(c.methods.get("boiled")),
                  label: "Boiled",
                  isDefault: true,
                  steps: ["Boil."],
                  ingredients: [
                    { ingredientId: must(c.ingredients.get("pasta_dry")), rawGPerBatch: 400 },
                  ],
                },
              ],
            },
          ],
        },
      };
    },
    "dish.update": async (r) => {
      const c = await catalog();
      const components = await repos().component.list({ dishId: populated.dishId });
      if (r() < 0.4)
        return {
          kind: "dish.update",
          payload: { dishId: populated.dishId, name: `Renamed ${tag(r)}`, flavourTags: ["smoky"] },
        };
      // Keep every component and the variants plans use; replace the rest of the tree.
      const tree = [];
      for (const component of components) {
        const variants = await repos().variant.list({ componentId: component.id });
        const used = variants.filter((v) => v.isDefault);
        tree.push({
          id: component.id,
          name: component.name,
          role: component.role,
          portioning: component.portioning,
          minServingG: component.minServingG,
          maxServingG: component.maxServingG + 10,
          defaultServingG: component.defaultServingG,
          stepG: component.stepG,
          required: component.required,
          variants: [
            ...used.map((v) => ({
              id: v.id,
              methodId: v.methodId,
              label: `${v.label} ${tag(r)}`,
              isDefault: true,
              steps: [...v.steps, "Rest 2 minutes."],
              ingredients: [
                {
                  ingredientId: must(c.ingredients.get("chicken_breast")),
                  rawGPerBatch: 1200 + Math.floor(r() * 200),
                },
              ],
            })),
            {
              methodId: must(c.methods.get("roasted")),
              label: "Roasted",
              isDefault: false,
              steps: ["Roast."],
              ingredients: [
                { ingredientId: must(c.ingredients.get("potato")), rawGPerBatch: 1300 },
              ],
            },
          ],
        });
      }
      return { kind: "dish.update", payload: { dishId: populated.dishId, components: tree } };
    },
    "dish.retire": () => ({ kind: "dish.retire", payload: { dishId: populated.dishId } }),
    "ingredient.create": (r) => ({
      kind: "ingredient.create",
      payload: {
        slug: `ing_${tag(r)}`,
        name: "Generated ingredient",
        category: "vegetable",
        kcal: 30,
        proteinG: 1,
        carbsG: 6,
        fatG: 0.2,
        satFatG: 0,
        fibreG: 2,
        solubleFibreG: null,
        sugarG: null,
        sodiumMg: null,
        nutritionSource: "manual",
        nutritionConfidence: "medium",
      },
    }),
    "ingredient.verify": (r) => ({
      kind: "ingredient.verify",
      payload: {
        ingredientId: populated.privateIngredientId,
        nutrition: { kcal: 200 + Math.floor(r() * 100) },
      },
    }),
    "plan.lock": () => ({ kind: "plan.lock", payload: { planMealId: populated.planMealId } }),
    "plan.unlock": () => ({
      kind: "plan.unlock",
      payload: { planMealId: populated.lockedMealId },
    }),
    "plan.swap_dish": async (r) => {
      const component = must(
        (await repos().component.list({ dishId: populated.adjusterDishId }))[0],
      );
      const variant = must((await repos().variant.list({ componentId: component.id }))[0]);
      const plates = await repos().plate.list({ planMealId: populated.planMealId });
      return {
        kind: "plan.swap_dish",
        payload: {
          planMealId: populated.planMealId,
          dishId: populated.adjusterDishId,
          scoreBreakdown: { total: round2(r()) },
          plates: plates.map((p) => ({
            memberId: p.memberId,
            fitStatus: "flexible_miss" as const,
            target: p.target,
            actual: { kcal: 300 },
            deviation: { kcal: -400 },
            items: [
              { componentId: component.id, variantId: variant.id, cookedG: 150, rawEquivalent: {} },
            ],
          })),
          cookBatches: [
            {
              variantId: variant.id,
              totalCookedG: 150 * plates.length,
              rawIngredients: {},
              servings: plates.length,
            },
          ],
        },
      };
    },
    "plate.override": async (r) => {
      const plateId = pick(r, populated.plateIds, "plate");
      const items = await repos().plate_item.list({ plateId });
      return {
        kind: "plate.override",
        payload: {
          plateId,
          fitStatus: "flexible_miss",
          actual: { kcal: 650 },
          deviation: { kcal: -50 },
          items: items.map((i) => ({
            componentId: i.componentId,
            variantId: i.variantId,
            cookedG: i.cookedG + 5 * (1 + Math.floor(r() * 4)),
            rawEquivalent: i.rawEquivalent,
          })),
        },
      };
    },
    "role.set": async (r) => {
      const login = pick(
        r,
        (await nonAdminLogins()).filter((l) => l.status === "active"),
        "active non-admin login",
      );
      return {
        kind: "role.set",
        payload: { userId: login.userId, role: login.role === "kitchen" ? "member" : "admin" },
      };
    },
    "access.block": async (r) => ({
      kind: "access.block",
      payload: {
        userId: pick(
          r,
          (await nonAdminLogins()).filter((l) => l.status === "active"),
          "active login",
        ).userId,
        reason: "generated",
      },
    }),
    "access.unblock": async (r) => ({
      kind: "access.unblock",
      payload: {
        userId: pick(
          r,
          (await repos().household_user.list()).filter((l) => l.status === "blocked"),
          "blocked login",
        ).userId,
      },
    }),
    "access.remove": async (r) => {
      const login = pick(r, await nonAdminLogins(), "non-admin login");
      return {
        kind: "access.remove",
        payload: {
          userId: login.userId,
          reason: "generated",
          archiveMember: login.memberId !== null && r() < 0.5,
        },
      };
    },
    "access.link_member": async (r) => {
      const logins = await nonAdminLogins();
      const linked = new Set(logins.map((l) => l.memberId));
      const admins = (await repos().household_user.list()).filter((l) => l.role === "admin");
      for (const l of admins) linked.add(l.memberId);
      const free = (await members()).filter((m) => !linked.has(m.id));
      const login = pick(r, logins, "non-admin login");
      if (free.length === 0 || (login.memberId !== null && r() < 0.4))
        return {
          kind: "access.link_member",
          payload: {
            userId: login.userId,
            memberId: login.memberId === null ? pick(r, free, "free member").id : null,
          },
        };
      return {
        kind: "access.link_member",
        payload: { userId: login.userId, memberId: pick(r, free, "free member").id },
      };
    },
    "meal_override.set": async (r) => {
      const shared = (await slots()).filter((s) => s.isShared);
      return {
        kind: "meal_override.set",
        payload: {
          planDate: futureDate(r),
          slotTypeId: pick(r, shared, "shared slot").id,
          kind: "make_individual",
        },
      };
    },
    "meal_override.remove": async (r) => {
      const o = pick(r, await repos().meal_override.list(), "meal override");
      return {
        kind: "meal_override.remove",
        payload: { planDate: o.planDate, slotTypeId: o.slotTypeId },
      };
    },
    "support.grant": (r) => ({
      kind: "support.grant",
      payload: {
        operatorUserId: populated.operatorUserId,
        expiresAt: new Date(Date.now() + (1 + Math.floor(r() * 29)) * 86_400_000).toISOString(),
      },
    }),
    "support.revoke": async (r) => ({
      kind: "support.revoke",
      payload: {
        grantId: pick(
          r,
          (await repos().support_grant.list()).filter((g) => g.revokedAt === null),
          "active grant",
        ).id,
      },
    }),
    "portion_bias.set": async (r) => {
      const existing = (await repos().portion_bias.list())[0];
      if (existing !== undefined && r() < 0.4)
        return {
          kind: "portion_bias.set",
          payload: {
            memberId: existing.memberId,
            componentRole: existing.componentRole,
            bias: null,
          },
        };
      const untargeted = (await members()).filter((m) => !m.isTargeted);
      return {
        kind: "portion_bias.set",
        payload: {
          memberId: pick(r, untargeted, "untargeted member").id,
          componentRole: pick(r, ["protein", "carb", "vegetable", "sauce"] as const, "role"),
          bias: round2(0.6 + r()),
        },
      };
    },
    "plan.save_days": async (r) => {
      const component = must(
        (await repos().component.list({ dishId: populated.dishId })).find(
          (c) => c.role === "protein",
        ),
      );
      const variant = must(
        (await repos().variant.list({ componentId: component.id })).find((v) => v.isDefault),
      );
      const m = pick(
        r,
        (await members()).filter((x) => x.isTargeted),
        "targeted member",
      );
      const dinner = must((await slots()).find((s) => s.key === "dinner"));
      return {
        kind: "plan.save_days",
        payload: {
          days: [
            {
              date: futureDate(r),
              weightsSnapshot: { appeal: round2(r()) },
              generatedAt: new Date().toISOString(),
              generatorVersion: "g3",
              meals: [
                {
                  slotTypeId: dinner.id,
                  dishId: populated.dishId,
                  memberScope: "shared",
                  scoreBreakdown: { total: round2(r()) },
                  plates: [
                    {
                      memberId: m.id,
                      fitStatus: "in_tolerance",
                      target: {},
                      actual: {},
                      deviation: {},
                      items: [
                        {
                          componentId: component.id,
                          variantId: variant.id,
                          cookedG: 180,
                          rawEquivalent: {},
                        },
                      ],
                    },
                  ],
                  cookBatches: [
                    { variantId: variant.id, totalCookedG: 180, rawIngredients: {}, servings: 1 },
                  ],
                },
              ],
            },
          ],
        },
      };
    },
  };
}
