// PLN-7 untargeted plates: default serving × appetite factor × learned role bias, on the grid and
// within [min, max] (SPEC-Q-14), in the member's highest-appeal allowed variant.
import { plateNutrients } from "../../nutrition/index.js";
import { rankVariants } from "./combos.js";
import { APPETITE_FACTORS } from "./config.js";
import { variantAllowed } from "./eligibility.js";
import { gridOf } from "./milp.js";
import type { DishForSolve, MemberCtx, PlateSolution } from "./types.js";

/** Nearest grid point to `grams` (ties up), clamped to the component's grid range. */
export function snapToGrid(grams: number, grid: ReturnType<typeof gridOf>): number {
  const k = Math.min(grid.kMax, Math.max(grid.kMin, Math.floor(grams / grid.unit + 0.5)));
  return k * grid.unit;
}

export function solveUntargeted(dish: DishForSolve, member: MemberCtx): PlateSolution {
  const items: PlateSolution["items"] = [];
  const explain: string[] = [];
  const nutrients: Parameters<typeof plateNutrients>[0] = [];
  const factor = APPETITE_FACTORS[member.appetite];
  for (const component of dish.components) {
    const [variant] = rankVariants(
      component.variants.filter((v) => variantAllowed(v, member)),
      member,
    );
    if (variant === undefined) {
      explain.push(
        component.required
          ? `Component ${component.id} has no variant this member may eat; the plate is incomplete`
          : `Component ${component.id} left out: no variant this member may eat`,
      );
      continue;
    }
    const grid = gridOf(component);
    const cookedG =
      component.portioning === "fixed"
        ? component.defaultServingG
        : snapToGrid(
            component.defaultServingG * factor * (member.roleBias[component.role] ?? 1),
            grid,
          );
    if (cookedG <= 0) continue;
    items.push({ componentId: component.id, variantId: variant.id, cookedG });
    nutrients.push({ per100g: variant.per100g, cookedG });
  }
  explain.push(
    `Untargeted portions: default serving × ${String(factor)} (${member.appetite} appetite)`,
  );
  return {
    status: "untargeted",
    items,
    adjusters: [],
    actual: plateNutrients(nutrients),
    deviation: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    objective: 0,
    fit: 1,
    explain,
  };
}
