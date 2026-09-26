// The one carbohydrate-basis setting (BLD-8 R-20, owner question OQ-7).
// `ingredient.carbs_g` and the engine's `carbs` are available carbohydrate. A member's carb target
// is matched against total carbohydrate (`carbs + fibre`) or available carbohydrate (`carbs`).

export const CARB_BASES = ["total", "available"] as const;
export type CarbBasis = (typeof CARB_BASES)[number];

/** OQ-7 default: total carbohydrate. The owner's answer changes only this line. */
export const CARB_TARGET_BASIS: CarbBasis = "total";
