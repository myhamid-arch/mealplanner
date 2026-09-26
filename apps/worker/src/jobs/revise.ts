// `recipe.revise` (W-2, FBK-7 rule 3; leaf-1.4.1 SPEC-Q-14): regenerate the variant (or every
// variant) of a dish that repeated review notes point at. The generator is asked for one dish
// with the current recipe and the notes; from its survivor, the component with the same role and
// the variant with the same method replace the old variant's ingredients, steps and cook time
// (`dish.update`, version bump). A seed dish is copy-on-write (REC-7): the household gets a copy
// with the revision. The job fails, changing nothing, when no survivor matches.
import type { ChangeOp } from "@mealplanner/core/changes";
import type { Json } from "@mealplanner/core/types";
import { applyChangeSet } from "@mealplanner/db/services/changes";
import { loadHouseholdConfig } from "@mealplanner/db/services/config";
import {
  copyPayload,
  dishTree,
  freeSlug,
  loadPlanPool,
  withNewIds,
  type TreeComponent,
  type TreeVariant,
} from "@mealplanner/db/services/plans";
import { newId } from "@mealplanner/db/schema";
import { generateDishes } from "../ai.js";
import type { JobContext } from "../runner.js";

export interface RevisionResult {
  changeSetId: string;
  dishId: string;
  copiedFrom: string | null;
  revisedVariants: string[];
  skipped: Array<{ variantId: string; reason: string }>;
}

export async function reviseRecipe(
  ctx: JobContext,
): Promise<RevisionResult & Record<string, Json>> {
  const p = ctx.job.payload as { dishId: string; variantId: string | null; notes: string[] };
  const hh = { householdId: ctx.household().householdId, userId: null, role: "system" as const };
  const db = ctx.rt.db;
  const config = await loadHouseholdConfig(db, hh);
  const pool = await loadPlanPool(db, hh, { includeDishIds: [p.dishId] });
  const planDish = pool.byId.get(p.dishId);
  if (planDish === undefined)
    throw new Error(`dish ${p.dishId} is not available to this household`);
  const tree = await dishTree(db, p.dishId);
  const active = new Set(config.slotTypes.filter((s) => s.active).map((s) => s.key));
  const slotKey = planDish.slotKeys.find((k) => active.has(k));
  if (slotKey === undefined) throw new Error("the dish suits none of the household's active slots");
  const methodKey = (methodId: string) => pool.catalog.methodKeyById.get(methodId) ?? "";
  const slugOf = (id: string) => pool.catalog.ingredients.get(id)?.slug ?? id;
  const targets = tree.components.flatMap((c) =>
    c.variants.filter((v) => p.variantId === null || v.id === p.variantId).map((v) => ({ c, v })),
  );
  if (targets.length === 0) throw new Error("the variant is not part of the dish");

  const describe = tree.components
    .map(
      (c) =>
        `${c.name} (${c.role}): ${c.variants
          .map(
            (v) =>
              `${v.label} [${methodKey(v.methodId)}]: ${v.ingredients.map((l) => `${slugOf(l.ingredientId)} ${String(l.rawGPerBatch)} g`).join(", ")}`,
          )
          .join("; ")}`,
    )
    .join(". ");
  const adminRequest =
    `Revise the recipe "${tree.dish.name}". Keep the same components, roles and preparation methods. ` +
    `Current recipe (raw grams per 1000 g cooked batch): ${describe}. ` +
    `Reviews repeatedly noted: ${p.notes.map((n) => n.replaceAll("_", " ")).join(", ")}. Fix these.`;
  const outcome = await generateDishes(ctx.rt, hh, {
    config,
    pool,
    date: new Date().toISOString().slice(0, 10),
    slotKey,
    count: 1,
    adminRequest,
    by: { actor: "system", source: "learning" },
    save: false,
  });
  if (outcome.status === "unavailable") throw new Error(outcome.reason);
  const survivor = outcome.survivors[0];
  if (survivor === undefined)
    throw new Error(
      `no revised recipe passed validation: ${outcome.run.rejected.flatMap((r) => r.reasons.map((x) => x.message)).join("; ")}`,
    );

  const revised = new Map<string, TreeVariant>();
  const skipped: RevisionResult["skipped"] = [];
  for (const { c, v } of targets) {
    const gc = survivor.dish.components.find((x) => x.role === c.role);
    const gv = gc?.variants.find((x) => x.method === methodKey(v.methodId));
    if (gv === undefined) {
      skipped.push({
        variantId: v.id,
        reason: "the revision has no variant with this role and method",
      });
      continue;
    }
    const lines = gv.ingredients.map((l) => ({ l, id: pool.catalog.idBySlug.get(l.slug) }));
    if (lines.some((x) => x.id === undefined)) {
      skipped.push({
        variantId: v.id,
        reason: "the revision needs an ingredient that is not in the catalogue",
      });
      continue;
    }
    revised.set(v.id, {
      ...v,
      steps: gv.steps,
      cookTimeMin: gv.cookTimeMin,
      referenceBatchCookedG: 1000,
      ingredients: lines.map(({ l, id }) => ({
        ingredientId: id ?? "",
        rawGPerBatch: l.rawGramsPerBatch,
        roleNote: l.note?.slice(0, 120) ?? null,
        isAbsorbedOil: l.isAbsorbedFat,
        cookingLiquid: null,
        yieldOverride: null,
      })),
    });
  }
  if (revised.size === 0)
    throw new Error(`nothing to revise: ${skipped.map((s) => s.reason).join("; ")}`);

  const components: TreeComponent[] = tree.components.map((c) => ({
    ...c,
    variants: c.variants.map((v) => revised.get(v.id) ?? v),
  }));
  let op: ChangeOp;
  let dishId = tree.dish.id;
  let copiedFrom: string | null = null;
  if (tree.dish.householdId === null) {
    const copy = withNewIds(components);
    dishId = newId();
    copiedFrom = tree.dish.id;
    op = {
      kind: "dish.create",
      payload: copyPayload(tree, {
        id: dishId,
        name: tree.dish.name,
        slug: await freeSlug(db, hh.householdId, tree.dish.slug),
        components: copy.components,
      }),
    };
  } else {
    op = { kind: "dish.update", payload: { dishId, components } };
  }
  const applied = await applyChangeSet(db, hh, {
    actor: "system",
    source: "learning",
    summary: `Revise the recipe for ${tree.dish.name} (${p.notes.join(", ").replaceAll("_", " ")})`,
    ops: [op],
  });
  return {
    changeSetId: applied.changeSetId,
    dishId,
    copiedFrom,
    revisedVariants: [...revised.keys()],
    skipped,
  };
}
