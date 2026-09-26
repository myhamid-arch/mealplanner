// Puts at least one row into every household-owned table of a loaded fixture household, using
// change sets where an op exists (DM-6) and direct scoped writes for the DM-6 exceptions and the
// tables written by later leaves' services (chat, proposals, AI audit, graph, nutrition cache).
import type { HouseholdContext } from "@mealplanner/core/types";
import { createRepos, createWriteRepos, type Executor } from "../../src/repos/index.js";
import { platformOperator, user } from "../../src/schema/index.js";
import { newId } from "../../src/schema/ids.js";
import { applyChangeSet } from "../../src/services/changes/index.js";
import { readCatalogIds } from "../../src/services/config/index.js";
import type { LoadedFixture } from "../../src/services/config/index.js";

export interface Populated {
  ctx: HouseholdContext;
  dishId: string;
  adjusterDishId: string;
  planMealId: string;
  lockedMealId: string;
  plateIds: string[];
  operatorUserId: string;
  privateIngredientId: string;
}

const PLAN_DATE = "2026-10-05";

function need<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`populate: ${what} missing`);
  return value;
}

export async function populateAllTables(db: Executor, loaded: LoadedFixture): Promise<Populated> {
  const ctx = loaded.adminContext;
  const read = createRepos(db, ctx);
  const catalog = await readCatalogIds(db);
  const members = await read.member.list();
  const targeted = need(
    members.find((m) => m.isTargeted),
    "targeted member",
  );
  const second = need(
    members.find((m) => m.id !== targeted.id),
    "second member",
  );
  const slotIds = loaded.slots;
  const suffix = ctx.householdId.replaceAll("-", "").slice(-12);

  // A platform operator (outside households, R2-ADM-8) for support.grant.
  const operatorUserId = newId();
  const now = new Date();
  await db.insert(user).values({
    id: operatorUserId,
    email: `operator-${suffix}@platform.example`,
    name: "Operator",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(platformOperator).values({ userId: operatorUserId, createdAt: now });

  const dishId = newId();
  const adjusterDishId = newId();
  const privateIngredientId = newId();
  const method = (key: string) => need(catalog.methods.get(key), `method ${key}`);
  const ingredient = (slug: string) => need(catalog.ingredients.get(slug), `ingredient ${slug}`);
  await applyChangeSet(db, ctx, {
    actor: "user",
    source: "ui",
    summary: "Populate configuration",
    ops: [
      {
        kind: "day_override.set",
        payload: {
          memberId: targeted.id,
          date: PLAN_DATE,
          kind: "absent_slot",
          slotTypeId: need(slotIds.lunch, "lunch"),
          active: true,
        },
      },
      {
        kind: "distribution.set",
        payload: {
          memberId: targeted.id,
          dayKind: "default",
          shares: [
            { slotTypeId: need(slotIds.breakfast, "breakfast"), share: 0.3 },
            { slotTypeId: need(slotIds.lunch, "lunch"), share: 0.3 },
            { slotTypeId: need(slotIds.dinner, "dinner"), share: 0.4 },
          ],
        },
      },
      {
        kind: "slot_target.set",
        payload: {
          memberId: targeted.id,
          dayKind: "default",
          slotTypeId: need(slotIds.dinner, "dinner"),
          values: { kcal: 700, proteinG: 55 },
        },
      },
      {
        kind: "preset.upsert",
        payload: {
          name: `Populate preset ${suffix}`,
          values: { appeal: 0.8 },
          appliesToWeekdays: [5, 6],
        },
      },
      {
        kind: "frequency.set",
        payload: {
          memberId: null,
          entityType: "cuisine",
          entityKey: "italian",
          minGapDays: 2,
          maxPerWeek: 3,
        },
      },
      {
        kind: "ingredient.create",
        payload: {
          id: privateIngredientId,
          slug: `private_${suffix}`,
          name: "House spice mix",
          category: "herb_spice",
          kcal: 250,
          proteinG: 10,
          carbsG: 40,
          fatG: 6,
          satFatG: 1,
          fibreG: 20,
          solubleFibreG: null,
          sugarG: null,
          sodiumMg: 1200,
          nutritionSource: "ai_estimate",
          nutritionConfidence: "low",
        },
      },
      {
        kind: "dish.create",
        payload: {
          id: dishId,
          name: "Populate grilled chicken bowl",
          slug: `populate_bowl_${suffix}`,
          description: "Test dish.",
          cuisineId: need(catalog.cuisines.get("levantine"), "levantine"),
          slotKeys: ["dinner", "lunch"],
          isPackable: true,
          servedColdOk: false,
          components: [
            {
              name: "Chicken",
              role: "protein",
              portioning: "continuous",
              minServingG: 80,
              maxServingG: 300,
              defaultServingG: 150,
              required: true,
              variants: [
                {
                  methodId: method("grilled"),
                  label: "Grilled",
                  isDefault: true,
                  steps: ["Grill."],
                  ingredients: [
                    { ingredientId: ingredient("chicken_breast"), rawGPerBatch: 1300 },
                    { ingredientId: privateIngredientId, rawGPerBatch: 8 },
                  ],
                },
                {
                  methodId: method("baked"),
                  label: "Baked",
                  isDefault: false,
                  steps: ["Bake."],
                  ingredients: [{ ingredientId: ingredient("chicken_breast"), rawGPerBatch: 1350 }],
                },
              ],
            },
            {
              name: "Rice",
              role: "carb",
              portioning: "continuous",
              minServingG: 0,
              maxServingG: 300,
              defaultServingG: 150,
              required: false,
              variants: [
                {
                  methodId: method("boiled"),
                  label: "Boiled",
                  isDefault: true,
                  steps: ["Boil."],
                  ingredients: [
                    { ingredientId: ingredient("basmati_rice"), rawGPerBatch: 360 },
                    {
                      ingredientId: ingredient("water"),
                      rawGPerBatch: 540,
                      cookingLiquid: "absorbed",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        kind: "dish.create",
        payload: {
          id: adjusterDishId,
          name: "Populate yogurt side",
          slug: `populate_yogurt_${suffix}`,
          description: "Adjuster.",
          cuisineId: need(catalog.cuisines.get("greek"), "greek"),
          slotKeys: ["snack", "dinner"],
          isPackable: true,
          servedColdOk: true,
          components: [
            {
              name: "Yogurt",
              role: "adjuster",
              portioning: "continuous",
              minServingG: 50,
              maxServingG: 250,
              defaultServingG: 100,
              required: true,
              variants: [
                {
                  methodId: method("raw"),
                  label: "Plain",
                  isDefault: true,
                  steps: ["Serve."],
                  ingredients: [{ ingredientId: ingredient("greek_yogurt_0"), rawGPerBatch: 1000 }],
                },
              ],
            },
          ],
        },
      },
      { kind: "adjusters.set", payload: { dishes: [{ dishId: adjusterDishId, enabled: true }] } },
      {
        kind: "meal_override.set",
        payload: {
          planDate: PLAN_DATE,
          slotTypeId: need(slotIds.dinner, "dinner"),
          kind: "split_member",
          memberIds: [second.id],
        },
      },
      {
        kind: "support.grant",
        payload: { operatorUserId, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
      },
    ],
  });

  const components = await read.component.list({ dishId });
  const chicken = need(
    components.find((c) => c.role === "protein"),
    "chicken component",
  );
  const rice = need(
    components.find((c) => c.role === "carb"),
    "rice component",
  );
  const chickenVariants = await read.variant.list({ componentId: chicken.id });
  const grilled = need(
    chickenVariants.find((v) => v.isDefault),
    "grilled variant",
  );
  const riceVariant = need((await read.variant.list({ componentId: rice.id }))[0], "rice variant");
  const planMealId = newId();
  const lockedMealId = newId();
  const plate = (memberId: string, cookedG: number) => ({
    memberId,
    fitStatus: "in_tolerance" as const,
    target: { kcal: 700 },
    actual: { kcal: 695 },
    deviation: { kcal: -5 },
    items: [
      {
        componentId: chicken.id,
        variantId: grilled.id,
        cookedG,
        rawEquivalent: { [ingredient("chicken_breast")]: cookedG * 1.3 },
      },
      {
        componentId: rice.id,
        variantId: riceVariant.id,
        cookedG: 150,
        rawEquivalent: { [ingredient("basmati_rice")]: 60 },
      },
    ],
  });
  await applyChangeSet(db, ctx, {
    actor: "system",
    source: "ui",
    summary: "Populate plan",
    ops: [
      {
        kind: "plan.save_days",
        payload: {
          days: [
            {
              date: PLAN_DATE,
              weightsSnapshot: { macroPrecision: 1 },
              generatedAt: now.toISOString(),
              generatorVersion: "test",
              meals: [
                {
                  id: planMealId,
                  slotTypeId: need(slotIds.dinner, "dinner"),
                  dishId,
                  memberScope: "shared",
                  scoreBreakdown: { total: 0.8 },
                  plates: [plate(targeted.id, 200), plate(second.id, 150)],
                  cookBatches: [
                    {
                      variantId: grilled.id,
                      totalCookedG: 350,
                      rawIngredients: { [ingredient("chicken_breast")]: 455 },
                      servings: 2,
                    },
                  ],
                },
                {
                  id: lockedMealId,
                  slotTypeId: need(slotIds.snack, "snack"),
                  dishId: adjusterDishId,
                  memberScope: targeted.id,
                  scoreBreakdown: { total: 0.6 },
                  plates: [],
                },
              ],
            },
          ],
        },
      },
    ],
  });
  const plateIds = (await read.plate.list({ planMealId })).map((p) => p.id);
  const blockable = (await read.household_user.list()).find((login) => login.role !== "admin");
  await applyChangeSet(db, ctx, {
    actor: "user",
    source: "ui",
    summary: "Populate lock and block",
    ops: [
      { kind: "plan.lock", payload: { planMealId: lockedMealId } },
      ...(blockable === undefined
        ? []
        : [
            {
              kind: "access.block" as const,
              payload: { userId: blockable.userId, reason: "populate" },
            },
          ]),
    ],
  });

  // DM-6 exceptions and tables owned by later leaves' services: written directly, household-scoped.
  const write = createWriteRepos(db, ctx);
  const adminUserId = need(ctx.userId, "admin user");
  await write.invite.insert({
    id: newId(),
    householdId: ctx.householdId,
    code: suffix.slice(0, 10).toUpperCase(),
    role: "member",
    memberId: second.id,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    usedAt: null,
    revokedAt: null,
    createdByUserId: adminUserId,
    createdAt: now,
  });
  await write.detail_level.insert({
    id: newId(),
    householdId: ctx.householdId,
    memberId: targeted.id,
    section: "targets",
    level: "expert",
  });
  await write.portion_bias.insert({
    householdId: ctx.householdId,
    memberId: second.id,
    componentRole: "carb",
    bias: 1.1,
  });
  await write.dish_nutrition_cache.insert({
    variantId: grilled.id,
    householdId: ctx.householdId,
    kcal: 150,
    protein: 30,
    carbs: 0,
    fat: 3,
    satFat: 0.8,
    fibre: 0,
    solubleFibre: null,
    sugar: 0,
    sodium: 60,
    cookedYieldGPerBatch: 1000,
    computedAt: now,
    engineVersion: "test",
  });
  const reviewId = newId();
  await write.review.insert({
    id: reviewId,
    householdId: ctx.householdId,
    authorUserId: adminUserId,
    onBehalfOfMemberId: targeted.id,
    targetType: "plan_meal",
    targetId: planMealId,
    planMealId,
    rating: 4,
    tags: ["tasty"],
    comment: null,
    parentReviewId: null,
    createdAt: now,
    editedAt: null,
    processedAt: null,
  });
  await write.review_reaction.insert({
    householdId: ctx.householdId,
    reviewId,
    userId: adminUserId,
    kind: "helpful",
  });
  const conversationId = newId();
  await write.conversation.insert({
    id: conversationId,
    householdId: ctx.householdId,
    userId: adminUserId,
    title: "Test chat",
    createdAt: now,
    archivedAt: null,
  });
  const messageId = newId();
  await write.chat_message.insert({
    id: messageId,
    householdId: ctx.householdId,
    conversationId,
    role: "user",
    content: [{ type: "text", text: "hi" }],
    createdAt: now,
  });
  await write.proposal.insert({
    id: newId(),
    householdId: ctx.householdId,
    origin: "agent_chat",
    conversationId,
    messageId,
    kind: "weights.set",
    payload: { appeal: 0.7 },
    rationale: "test",
    evidence: {},
    fingerprint: `weights:${suffix}`,
    status: "pending",
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    changeSetId: null,
    expiresAt: new Date(Date.now() + 14 * 86_400_000),
  });
  await write.ai_generation.insert({
    id: newId(),
    householdId: ctx.householdId,
    purpose: "chat",
    model: "stub",
    requestSummary: {},
    responseRaw: {},
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    stopReason: "end_turn",
    validationErrors: null,
    createdAt: now,
  });
  const nodeA = newId();
  const nodeB = newId();
  await write.kg_node.insert({
    id: nodeA,
    householdId: ctx.householdId,
    type: "Member",
    key: targeted.id,
    label: "member",
    props: {},
  });
  await write.kg_node.insert({
    id: nodeB,
    householdId: ctx.householdId,
    type: "Dish",
    key: dishId,
    label: "dish",
    props: {},
  });
  await write.kg_edge.insert({
    id: newId(),
    householdId: ctx.householdId,
    srcId: nodeA,
    dstId: nodeB,
    type: "LIKES",
    weight: 0.5,
    props: {},
    source: "learned",
    updatedAt: now,
  });

  return {
    ctx,
    dishId,
    adjusterDishId,
    planMealId,
    lockedMealId,
    plateIds,
    operatorUserId,
    privateIngredientId,
  };
}
