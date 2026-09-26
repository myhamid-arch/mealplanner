// Target resolver (04 §3, PLN-4): @mealplanner/core/planner/targets.
export { CARB_BASES, CARB_TARGET_BASIS, type CarbBasis } from "./config.js";
export { attendedSlots, dayKindOf } from "./day.js";
export { TargetResolverError, type TargetResolverErrorCode } from "./errors.js";
export { FIBRE_G_PER_1000_KCAL, SOLUBLE_SHARE_OF_FIBRE, resolveSlotTargets } from "./resolve.js";
export { apportion, slotShares, slotWeight } from "./shares.js";
export type { MacroTolerance, ResolveOptions, SlotTarget } from "./types.js";
