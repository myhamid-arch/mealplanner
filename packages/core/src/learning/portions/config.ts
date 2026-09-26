// FBK-5 constants for untargeted members' learned role bias (leaf-1.3.2 SPEC-Q-3).
export { PORTION_BIAS_BOUNDS } from "../../types/index.js";

/** `too_much` multiplies the bias by 0.9; `too_little` and `still_hungry` by 1.1. */
export const PORTION_FACTORS = { down: 0.9, up: 1.1 } as const;
export const DOWN_TAGS: readonly string[] = ["too_much"];
export const UP_TAGS: readonly string[] = ["too_little", "still_hungry"];

/** `portion_bias.bias` is `numeric(10,3)`. */
export const BIAS_DECIMALS = 3;
