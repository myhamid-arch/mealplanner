// Expected outcomes of the recorded G1 batches (shared by the tests and the verify script).
import type { DefectCode } from "../../../src/recipes/index.js";

/** The defects batch: dish name → the REC-5 defect class it carries. */
export const DEFECT_CLASSES: ReadonlyArray<{ dish: string; codes: DefectCode[]; step: number }> = [
  { dish: "Tandoori chicken with cumin rice and raita", codes: ["unknown_ingredient"], step: 2 },
  { dish: "Grilled chicken with freekeh and tahini sauce", codes: ["excluded_dietary_flag"], step: 3 },
  { dish: "Chicken or lamb with rice and yoghurt sauce", codes: ["variant_drift"], step: 4 },
  { dish: "Red wine braised beef with mash", codes: ["atwater_variant"], step: 5 },
  {
    dish: "Lemon garlic chicken with rice, roasted vegetables and yogurt mint sauce",
    codes: ["duplicate_name", "duplicate_ingredients"],
    step: 6,
  },
];
export const INFEASIBLE_DISH = "Garden salad with lemon dressing";
export const DEFECTS_VALID_DISH = "Herb-crusted cod with crushed potatoes, peas and lemon-dill yoghurt";

