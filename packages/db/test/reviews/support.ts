// Shared setup for the reviews and learning integration tests (leaf 1.3.2): fixture F1 plus one
// F3 dish (a levantine dish, so F1's liked-cuisine household preference applies), and a dinner plan
// with plates for a targeted adult and two untargeted children.
import type { FixtureInput, HouseholdContext, HouseholdRole } from "@mealplanner/core/types";
import { createRepos, type Executor } from "../../src/repos/index.js";
import { applyChangeSet } from "../../src/services/changes/index.js";
import { loadFixture, type LoadedFixture } from "../../src/services/config/index.js";
import type { TestDatabase } from "../support/db.js";
import { F1, F3, catalogDatabase } from "../support/fixtures.js";
import { must } from "../support/must.js";

export const DISH_SLUG = "chicken_rice_plate";
export const PLAN_DATE = "2026-09-21";

/** F1 with the F3 dish added; `likedCuisines: false` gives a household with no preferences. */
export function f1WithDish(options: { likedCuisines?: boolean; id?: string } = {}): FixtureInput {
  const dish = must(
    F3.dishes?.find((d) => d.slug === DISH_SLUG),
    DISH_SLUG,
  );
  return {
    ...F1,
    id: options.id ?? "F1R",
    cuisines: options.likedCuisines === false ? { liked: [], disliked: [] } : F1.cuisines,
    dishes: [dish],
  };
}

export interface ReviewHousehold {
  loaded: LoadedFixture;
  dishId: string;
  planMealId: string;
  planDayId: string;
  /** Context of a fixture login. */
  as: (userKey: string) => HouseholdContext;
  member: (key: string) => string;
}

/** Loads the household and saves one dinner with a plate for adult_a, c1 and c2. */
export async function reviewHousehold(
  database: TestDatabase,
  fixture: FixtureInput = f1WithDish(),
): Promise<ReviewHousehold> {
  const loaded = await loadFixture(database.db, fixture);
  const ctx = loaded.adminContext;
  const r = createRepos(database.db, ctx);
  const dishId = must(loaded.dishes[DISH_SLUG], "dish");
  const components = await r.component.list({ dishId });
  const items: {
    componentId: string;
    variantId: string;
    cookedG: number;
    rawEquivalent: Record<string, number>;
  }[] = [];
  for (const component of components) {
    const variants = await r.variant.list({ componentId: component.id });
    const variant = must(variants.find((v) => v.isDefault) ?? variants[0], "variant");
    items.push({
      componentId: component.id,
      variantId: variant.id,
      cookedG: component.defaultServingG,
      rawEquivalent: {},
    });
  }
  const member = (key: string) => must(loaded.members[key], `member ${key}`);
  const plate = (memberId: string) => ({
    memberId,
    fitStatus: "in_tolerance" as const,
    target: {},
    actual: {},
    deviation: {},
    items,
  });
  await applyChangeSet(database.db, ctx, {
    actor: "system",
    source: "ui",
    summary: "Test plan",
    ops: [
      {
        kind: "plan.save_days",
        payload: {
          days: [
            {
              date: PLAN_DATE,
              weightsSnapshot: {},
              generatedAt: new Date("2026-09-20T12:00:00Z").toISOString(),
              generatorVersion: "test",
              meals: [
                {
                  slotTypeId: must(loaded.slots.dinner, "dinner"),
                  dishId,
                  memberScope: "shared",
                  scoreBreakdown: {},
                  plates: [plate(member("adult_a")), plate(member("c1")), plate(member("c2"))],
                },
              ],
            },
          ],
        },
      },
    ],
  });
  const [day] = await r.plan_day.list({ date: PLAN_DATE });
  const [meal] = await r.plan_meal.list({ planDayId: must(day, "plan day").id });
  const roles: Record<string, HouseholdRole> = {};
  for (const u of fixture.users) roles[u.key] = u.role;
  return {
    loaded,
    dishId,
    planMealId: must(meal, "plan meal").id,
    planDayId: must(day, "plan day").id,
    member,
    as: (userKey) => ({
      householdId: loaded.householdId,
      userId: must(loaded.users[userKey], `user ${userKey}`),
      role: must(roles[userKey], `role of ${userKey}`),
    }),
  };
}

/** A fresh migrated database with the fixture catalogue. */
export function reviewDatabase(): Promise<TestDatabase> {
  return catalogDatabase();
}

export async function preferences(db: Executor, ctx: HouseholdContext) {
  return createRepos(db, ctx).preference.list();
}
