// Golden cases for NUT-3 (ledger G1). Each expected value was worked out by hand from the
// fixture catalogue with the formulas of 03-nutrition-engine §3 (plus BLD-8 R-12/R-13), not taken
// from the engine. The arithmetic is shown above each case: raw nutrients are per 100 g, so an
// ingredient contributes rawG/100 x its per-100 g value; values are rounded to 6 decimals.
import type { Nutrients, VariantInput } from "../../../src/nutrition/index.js";

export type GoldenTag =
  | "grilled_vs_fried"
  | "fat_retention"
  | "oil_absorption"
  | "breaded"
  | "boiled_grain"
  | "absorbed_liquid"
  | "yield_override"
  | "retained_water_stew"
  | "absorbed_oil_cap"
  | "two_absorbed_fats"
  | "raw"
  | "known_bound_zero"
  | "unknown_nutrient";

export type GoldenCase = {
  id: string;
  title: string;
  tags: GoldenTag[];
  variant: VariantInput;
  expected: { per100g: Nutrients; batchCookedG: number };
};

export const GOLDEN_CASES: GoldenCase[] = [
  // Grilled chicken breast
  //   chicken_breast 1000 g (grilled x poultry: yield 0.75, fatRet 0.85, abs 0): mass 1000*0.75 = 750.0; fat 1000*2.6/100*0.85 = 22.1, fat lost 3.9, kcal 1000*120/100 - 9*3.9 = 1164.9
  //   W = 750.0 g; N = kcal 1164.9, protein 225.0, carbs 0.0, fat 22.1, satFat 5.1, fibre 0.0, solubleFibre 0.0, sugar 0.0, sodiumMg 450.0
  //   per 100 g cooked = N / W * 100
  {
    id: "grilled_chicken",
    title: "Grilled chicken breast",
    tags: ["grilled_vs_fried", "fat_retention"],
    variant: {
      method: "grilled",
      ingredients: [{ ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false }],
    },
    expected: {
      per100g: {
        kcal: 155.32,
        protein: 30,
        carbs: 0,
        fat: 2.946667,
        satFat: 0.68,
        fibre: 0,
        solubleFibre: 0,
        sugar: 0,
        sodiumMg: 60,
      },
      batchCookedG: 750,
    },
  },
  // Deep-fried chicken breast (same raw, 300 g oil listed)
  //   chicken_breast 1000 g (deep_fried x poultry: yield 0.8, fatRet 1.0, abs 7): mass 1000*0.8 = 800.0; fat 1000*2.6/100*1.0 = 26.0, fat lost 0.0, kcal 1000*120/100 - 9*0.0 = 1200.0; absorbs 1000*7/100 = 70.0 g
  //   sunflower_oil 300 g: absorbed fat, listed; L += 300
  //   A = min(capacity 70.0, listed 300.0) = 70.0
  //   sunflower_oil: 70.0*300/300.0 = 70.0 g absorbed: kcal 618.8, fat 70.0, satFat 7.0
  //   W = 870.0 g; N = kcal 1818.8, protein 225.0, carbs 0.0, fat 96.0, satFat 13.0, fibre 0.0, solubleFibre 0.0, sugar 0.0, sodiumMg 450.0
  //   per 100 g cooked = N / W * 100
  {
    id: "deep_fried_chicken",
    title: "Deep-fried chicken breast (same raw, 300 g oil listed)",
    tags: ["grilled_vs_fried", "oil_absorption"],
    variant: {
      method: "deep_fried",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 300, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 209.057471,
        protein: 25.862069,
        carbs: 0,
        fat: 11.034483,
        satFat: 1.494253,
        fibre: 0,
        solubleFibre: 0,
        sugar: 0,
        sodiumMg: 51.724138,
      },
      batchCookedG: 870,
    },
  },
  // Grilled white fish
  //   white_fish 1000 g (grilled x fish: yield 0.8, fatRet 0.9, abs 0): mass 1000*0.8 = 800.0; fat 1000*1.2/100*0.9 = 10.8, fat lost 1.2, kcal 1000*90/100 - 9*1.2 = 889.2
  //   W = 800.0 g; N = kcal 889.2, protein 190.0, carbs 0.0, fat 10.8, satFat 2.7, fibre 0.0, solubleFibre 0.0, sugar 0.0, sodiumMg 600.0
  //   per 100 g cooked = N / W * 100
  {
    id: "grilled_fish",
    title: "Grilled white fish",
    tags: ["grilled_vs_fried", "fat_retention"],
    variant: {
      method: "grilled",
      ingredients: [{ ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false }],
    },
    expected: {
      per100g: {
        kcal: 111.15,
        protein: 23.75,
        carbs: 0,
        fat: 1.35,
        satFat: 0.3375,
        fibre: 0,
        solubleFibre: 0,
        sugar: 0,
        sodiumMg: 75,
      },
      batchCookedG: 800,
    },
  },
  // Deep-fried white fish, unbreaded
  //   white_fish 1000 g (deep_fried x fish: yield 0.8, fatRet 1.0, abs 6): mass 1000*0.8 = 800.0; fat 1000*1.2/100*1.0 = 12.0, fat lost 0.0, kcal 1000*90/100 - 9*0.0 = 900.0; absorbs 1000*6/100 = 60.0 g
  //   sunflower_oil 500 g: absorbed fat, listed; L += 500
  //   A = min(capacity 60.0, listed 500.0) = 60.0
  //   sunflower_oil: 60.0*500/500.0 = 60.0 g absorbed: kcal 530.4, fat 60.0, satFat 6.0
  //   W = 860.0 g; N = kcal 1430.4, protein 190.0, carbs 0.0, fat 72.0, satFat 9.0, fibre 0.0, solubleFibre 0.0, sugar 0.0, sodiumMg 600.0
  //   per 100 g cooked = N / W * 100
  {
    id: "deep_fried_fish",
    title: "Deep-fried white fish, unbreaded",
    tags: ["grilled_vs_fried", "oil_absorption"],
    variant: {
      method: "deep_fried",
      ingredients: [
        { ingredientId: "white_fish", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 500, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 166.325581,
        protein: 22.093023,
        carbs: 0,
        fat: 8.372093,
        satFat: 1.046512,
        fibre: 0,
        solubleFibre: 0,
        sugar: 0,
        sodiumMg: 69.767442,
      },
      batchCookedG: 860,
    },
  },
  // Breaded-fried chicken
  //   chicken_breast 600 g (breaded_fried x poultry: yield 0.88, fatRet 1.0, abs 12): mass 600*0.88 = 528.0; fat 600*2.6/100*1.0 = 15.6, fat lost 0.0, kcal 600*120/100 - 9*0.0 = 720.0; absorbs 600*12/100 = 72.0 g
  //   egg 100 g (breaded_fried x egg: yield 0.9, fatRet 1.0, abs 5): mass 100*0.9 = 90.0; fat 100*9.5/100*1.0 = 9.5, fat lost 0.0, kcal 100*143/100 - 9*0.0 = 143.0; absorbs 100*5/100 = 5.0 g
  //   breadcrumbs 120 g (breaded_fried x bakery: yield 1.0, fatRet 1.0, abs 20): mass 120*1.0 = 120.0; fat 120*5.3/100*1.0 = 6.36, fat lost 0.0, kcal 120*395/100 - 9*0.0 = 474.0; absorbs 120*20/100 = 24.0 g
  //   sunflower_oil 400 g: absorbed fat, listed; L += 400
  //   A = min(capacity 101.0, listed 400.0) = 101.0
  //   sunflower_oil: 101.0*400/400.0 = 101.0 g absorbed: kcal 892.84, fat 101.0, satFat 10.1
  //   W = 839.0 g; N = kcal 2229.84, protein 163.68, carbs 87.1, fat 132.46, satFat 18.24, fibre 5.4, solubleFibre 1.8, sugar 7.84, sodiumMg 1290.4
  //   per 100 g cooked = N / W * 100
  {
    id: "breaded_fried_chicken",
    title: "Breaded-fried chicken",
    tags: ["breaded", "oil_absorption"],
    variant: {
      method: "breaded_fried",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 600, isAbsorbedOil: false },
        { ingredientId: "egg", rawG: 100, isAbsorbedOil: false },
        { ingredientId: "breadcrumbs", rawG: 120, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 400, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 265.77354,
        protein: 19.508939,
        carbs: 10.381406,
        fat: 15.787843,
        satFat: 2.174017,
        fibre: 0.643623,
        solubleFibre: 0.214541,
        sugar: 0.934446,
        sodiumMg: 153.802145,
      },
      batchCookedG: 839,
    },
  },
  // Breaded-baked chicken, brushing oil not absorbed
  //   chicken_breast 600 g (breaded_baked x poultry: yield 0.8, fatRet 0.95, abs 0): mass 600*0.8 = 480.0; fat 600*2.6/100*0.95 = 14.82, fat lost 0.78, kcal 600*120/100 - 9*0.78 = 712.98
  //   egg 100 g (breaded_baked x egg: yield 0.9, fatRet 1.0, abs 0): mass 100*0.9 = 90.0; fat 100*9.5/100*1.0 = 9.5, fat lost 0.0, kcal 100*143/100 - 9*0.0 = 143.0
  //   breadcrumbs 120 g (breaded_baked x bakery: yield 0.95, fatRet 1.0, abs 0): mass 120*0.95 = 114.0; fat 120*5.3/100*1.0 = 6.36, fat lost 0.0, kcal 120*395/100 - 9*0.0 = 474.0
  //   olive_oil 20 g (breaded_baked x oil_fat: yield 1.0, fatRet 1.0, abs 0): mass 20*1.0 = 20.0; fat 20*100/100*1.0 = 20.0, fat lost 0.0, kcal 20*884/100 - 9*0.0 = 176.8
  //   W = 704.0 g; N = kcal 1506.78, protein 163.68, carbs 87.1, fat 50.68, satFat 10.76, fibre 5.4, solubleFibre 1.8, sugar 7.84, sodiumMg 1290.8
  //   per 100 g cooked = N / W * 100
  {
    id: "breaded_baked_chicken",
    title: "Breaded-baked chicken, brushing oil not absorbed",
    tags: ["breaded", "fat_retention"],
    variant: {
      method: "breaded_baked",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 600, isAbsorbedOil: false },
        { ingredientId: "egg", rawG: 100, isAbsorbedOil: false },
        { ingredientId: "breadcrumbs", rawG: 120, isAbsorbedOil: false },
        { ingredientId: "olive_oil", rawG: 20, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 214.03125,
        protein: 23.25,
        carbs: 12.372159,
        fat: 7.198864,
        satFat: 1.528409,
        fibre: 0.767045,
        solubleFibre: 0.255682,
        sugar: 1.113636,
        sodiumMg: 183.352273,
      },
      batchCookedG: 704,
    },
  },
  // Boiled basmati rice with absorbed water
  //   basmati_rice 300 g (boiled x grain: yield 2.8, fatRet 1.0, abs 0): mass 300*2.8 = 840.0; fat 300*0.9/100*1.0 = 2.7, fat lost 0.0, kcal 300*360/100 - 9*0.0 = 1080.0
  //   water 900 g absorbed liquid: mass 0; nutrients 900/100 x per-100 g = kcal 0.0, P 0.0, C 0.0, F 0.0, Na 0.0
  //   W = 840.0 g; N = kcal 1080.0, protein 22.5, carbs 237.0, fat 2.7, satFat 0.6, fibre 3.9, solubleFibre 1.2, sugar 0.6, sodiumMg 3.0
  //   per 100 g cooked = N / W * 100
  {
    id: "boiled_rice",
    title: "Boiled basmati rice with absorbed water",
    tags: ["boiled_grain", "absorbed_liquid"],
    variant: {
      method: "boiled",
      ingredients: [
        { ingredientId: "basmati_rice", rawG: 300, isAbsorbedOil: false },
        { ingredientId: "water", rawG: 900, isAbsorbedOil: false, cookingLiquid: "absorbed" },
      ],
    },
    expected: {
      per100g: {
        kcal: 128.571429,
        protein: 2.678571,
        carbs: 28.214286,
        fat: 0.321429,
        satFat: 0.071429,
        fibre: 0.464286,
        solubleFibre: 0.142857,
        sugar: 0.071429,
        sodiumMg: 0.357143,
      },
      batchCookedG: 840,
    },
  },
  // Boiled rice at 1 : 1.5 water, yield override 2.5
  //   basmati_rice 400 g (boiled x grain: yield 2.5 (override), fatRet 1.0, abs 0): mass 400*2.5 = 1000.0; fat 400*0.9/100*1.0 = 3.6, fat lost 0.0, kcal 400*360/100 - 9*0.0 = 1440.0
  //   water 600 g absorbed liquid: mass 0; nutrients 600/100 x per-100 g = kcal 0.0, P 0.0, C 0.0, F 0.0, Na 0.0
  //   W = 1000.0 g; N = kcal 1440.0, protein 30.0, carbs 316.0, fat 3.6, satFat 0.8, fibre 5.2, solubleFibre 1.6, sugar 0.8, sodiumMg 4.0
  //   per 100 g cooked = N / W * 100
  {
    id: "boiled_rice_override",
    title: "Boiled rice at 1 : 1.5 water, yield override 2.5",
    tags: ["boiled_grain", "yield_override", "absorbed_liquid"],
    variant: {
      method: "boiled",
      ingredients: [
        { ingredientId: "basmati_rice", rawG: 400, isAbsorbedOil: false, yieldOverride: 2.5 },
        { ingredientId: "water", rawG: 600, isAbsorbedOil: false, cookingLiquid: "absorbed" },
      ],
    },
    expected: {
      per100g: {
        kcal: 144,
        protein: 3,
        carbs: 31.6,
        fat: 0.36,
        satFat: 0.08,
        fibre: 0.52,
        solubleFibre: 0.16,
        sugar: 0.08,
        sodiumMg: 0.4,
      },
      batchCookedG: 1000,
    },
  },
  // Rice cooked in absorbed chicken stock, salted
  //   basmati_rice 300 g (boiled x grain: yield 2.8, fatRet 1.0, abs 0): mass 300*2.8 = 840.0; fat 300*0.9/100*1.0 = 2.7, fat lost 0.0, kcal 300*360/100 - 9*0.0 = 1080.0
  //   chicken_stock 750 g absorbed liquid: mass 0; nutrients 750/100 x per-100 g = kcal 127.5, P 18.75, C 6.75, F 3.75, Na 2550.0
  //   salt 3 g (boiled x herb_spice: yield 1.0, fatRet 1.0, abs 0): mass 3*1.0 = 3.0; fat 3*0/100*1.0 = 0.0, fat lost 0.0, kcal 3*0/100 - 9*0.0 = 0.0
  //   W = 843.0 g; N = kcal 1207.5, protein 41.25, carbs 243.75, fat 6.45, satFat 1.725, fibre 3.9, solubleFibre 1.2, sugar 3.6, sodiumMg 3715.74
  //   per 100 g cooked = N / W * 100
  {
    id: "rice_in_stock",
    title: "Rice cooked in absorbed chicken stock, salted",
    tags: ["boiled_grain", "absorbed_liquid", "known_bound_zero"],
    variant: {
      method: "boiled",
      ingredients: [
        { ingredientId: "basmati_rice", rawG: 300, isAbsorbedOil: false },
        {
          ingredientId: "chicken_stock",
          rawG: 750,
          isAbsorbedOil: false,
          cookingLiquid: "absorbed",
        },
        { ingredientId: "salt", rawG: 3, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 143.238434,
        protein: 4.893238,
        carbs: 28.914591,
        fat: 0.765125,
        satFat: 0.204626,
        fibre: 0.462633,
        solubleFibre: 0.142349,
        sugar: 0.427046,
        sodiumMg: 440.775801,
      },
      batchCookedG: 843,
    },
  },
  // Red lentil stew with retained water
  //   red_lentils 250 g (stewed x legume: yield 1.0, fatRet 1.0, abs 0): mass 250*1.0 = 250.0; fat 250*2.2/100*1.0 = 5.5, fat lost 0.0, kcal 250*358/100 - 9*0.0 = 895.0
  //   water 1000 g (stewed x beverage: yield 0.8, fatRet 1.0, abs 0): mass 1000*0.8 = 800.0; fat 1000*0/100*1.0 = 0.0, fat lost 0.0, kcal 1000*0/100 - 9*0.0 = 0.0
  //   onion 150 g (stewed x vegetable: yield 0.9, fatRet 1.0, abs 0): mass 150*0.9 = 135.0; fat 150*0.1/100*1.0 = 0.15, fat lost 0.0, kcal 150*40/100 - 9*0.0 = 60.0
  //   olive_oil 20 g (stewed x oil_fat: yield 1.0, fatRet 1.0, abs 0): mass 20*1.0 = 20.0; fat 20*100/100*1.0 = 20.0, fat lost 0.0, kcal 20*884/100 - 9*0.0 = 176.8
  //   salt 5 g (stewed x herb_spice: yield 1.0, fatRet 1.0, abs 0): mass 5*1.0 = 5.0; fat 5*0/100*1.0 = 0.0, fat lost 0.0, kcal 5*0/100 - 9*0.0 = 0.0
  //   W = 1210.0 g; N = kcal 1131.8, protein 63.15, carbs 170.65, fat 25.65, satFat 3.61, fibre 29.55, solubleFibre 6.35, sugar 11.3, sodiumMg 1961.8
  //   per 100 g cooked = N / W * 100
  {
    id: "lentil_stew",
    title: "Red lentil stew with retained water",
    tags: ["retained_water_stew", "known_bound_zero"],
    variant: {
      method: "stewed",
      ingredients: [
        { ingredientId: "red_lentils", rawG: 250, isAbsorbedOil: false },
        { ingredientId: "water", rawG: 1000, isAbsorbedOil: false, cookingLiquid: "retained" },
        { ingredientId: "onion", rawG: 150, isAbsorbedOil: false },
        { ingredientId: "olive_oil", rawG: 20, isAbsorbedOil: false },
        { ingredientId: "salt", rawG: 5, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 93.53719,
        protein: 5.219008,
        carbs: 14.103306,
        fat: 2.119835,
        satFat: 0.298347,
        fibre: 2.442149,
        solubleFibre: 0.524793,
        sugar: 0.933884,
        sodiumMg: 162.132231,
      },
      batchCookedG: 1210,
    },
  },
  // Chicken soup with retained water and vegetables
  //   chicken_breast 400 g (stewed x poultry: yield 0.9, fatRet 0.9, abs 0): mass 400*0.9 = 360.0; fat 400*2.6/100*0.9 = 9.36, fat lost 1.04, kcal 400*120/100 - 9*1.04 = 470.64
  //   water 1500 g (stewed x beverage: yield 0.8, fatRet 1.0, abs 0): mass 1500*0.8 = 1200.0; fat 1500*0/100*1.0 = 0.0, fat lost 0.0, kcal 1500*0/100 - 9*0.0 = 0.0
  //   carrot 200 g (stewed x vegetable: yield 0.9, fatRet 1.0, abs 0): mass 200*0.9 = 180.0; fat 200*0.2/100*1.0 = 0.4, fat lost 0.0, kcal 200*41/100 - 9*0.0 = 82.0
  //   onion 150 g (stewed x vegetable: yield 0.9, fatRet 1.0, abs 0): mass 150*0.9 = 135.0; fat 150*0.1/100*1.0 = 0.15, fat lost 0.0, kcal 150*40/100 - 9*0.0 = 60.0
  //   salt 8 g (stewed x herb_spice: yield 1.0, fatRet 1.0, abs 0): mass 8*1.0 = 8.0; fat 8*0/100*1.0 = 0.0, fat lost 0.0, kcal 8*0/100 - 9*0.0 = 0.0
  //   W = 1883.0 g; N = kcal 612.64, protein 93.45, carbs 29.3, fat 9.91, satFat 2.28, fibre 8.15, solubleFibre 3.75, sugar 15.7, sodiumMg 3424.64
  //   per 100 g cooked = N / W * 100
  {
    id: "chicken_soup",
    title: "Chicken soup with retained water and vegetables",
    tags: ["retained_water_stew", "fat_retention", "known_bound_zero"],
    variant: {
      method: "stewed",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 400, isAbsorbedOil: false },
        { ingredientId: "water", rawG: 1500, isAbsorbedOil: false, cookingLiquid: "retained" },
        { ingredientId: "carrot", rawG: 200, isAbsorbedOil: false },
        { ingredientId: "onion", rawG: 150, isAbsorbedOil: false },
        { ingredientId: "salt", rawG: 8, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 32.535316,
        protein: 4.962825,
        carbs: 1.556028,
        fat: 0.526288,
        satFat: 0.121083,
        fibre: 0.43282,
        solubleFibre: 0.19915,
        sugar: 0.833776,
        sodiumMg: 181.871482,
      },
      batchCookedG: 1883,
    },
  },
  // Shallow-fried halloumi, 5 g oil listed
  //   halloumi 500 g (shallow_fried x dairy: yield 0.9, fatRet 0.95, abs 10): mass 500*0.9 = 450.0; fat 500*25/100*0.95 = 118.75, fat lost 6.25, kcal 500*321/100 - 9*6.25 = 1548.75; absorbs 500*10/100 = 50.0 g
  //   sunflower_oil 5 g: absorbed fat, listed; L += 5
  //   A = min(capacity 50.0, listed 5.0) = 5.0
  //   sunflower_oil: 5.0*5/5.0 = 5.0 g absorbed: kcal 44.2, fat 5.0, satFat 0.5
  //   W = 455.0 g; N = kcal 1592.95, protein 105.0, carbs 11.0, fat 123.75, satFat 81.25, fibre 0.0, solubleFibre 0.0, sugar 11.0, sodiumMg 6000.0
  //   per 100 g cooked = N / W * 100
  {
    id: "shallow_fried_halloumi",
    title: "Shallow-fried halloumi, 5 g oil listed",
    tags: ["absorbed_oil_cap", "fat_retention"],
    variant: {
      method: "shallow_fried",
      ingredients: [
        { ingredientId: "halloumi", rawG: 500, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 5, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 350.098901,
        protein: 23.076923,
        carbs: 2.417582,
        fat: 27.197802,
        satFat: 17.857143,
        fibre: 0,
        solubleFibre: 0,
        sugar: 2.417582,
        sodiumMg: 1318.681319,
      },
      batchCookedG: 455,
    },
  },
  // Deep-fried potato chips, 2 kg oil in the fryer
  //   potato 1000 g (deep_fried x starch: yield 0.55, fatRet 1.0, abs 10): mass 1000*0.55 = 550.0; fat 1000*0.1/100*1.0 = 1.0, fat lost 0.0, kcal 1000*77/100 - 9*0.0 = 770.0; absorbs 1000*10/100 = 100.0 g
  //   sunflower_oil 2000 g: absorbed fat, listed; L += 2000
  //   A = min(capacity 100.0, listed 2000.0) = 100.0
  //   sunflower_oil: 100.0*2000/2000.0 = 100.0 g absorbed: kcal 884.0, fat 100.0, satFat 10.0
  //   W = 650.0 g; N = kcal 1654.0, protein 20.0, carbs 160.0, fat 101.0, satFat 10.3, fibre 22.0, solubleFibre 10.0, sugar 8.0, sodiumMg 60.0
  //   per 100 g cooked = N / W * 100
  {
    id: "deep_fried_chips",
    title: "Deep-fried potato chips, 2 kg oil in the fryer",
    tags: ["oil_absorption"],
    variant: {
      method: "deep_fried",
      ingredients: [
        { ingredientId: "potato", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 2000, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 254.461538,
        protein: 3.076923,
        carbs: 24.615385,
        fat: 15.538462,
        satFat: 1.584615,
        fibre: 3.384615,
        solubleFibre: 1.538462,
        sugar: 1.230769,
        sodiumMg: 9.230769,
      },
      batchCookedG: 650,
    },
  },
  // Shallow-fried potato in oil and ghee
  //   potato 800 g (shallow_fried x starch: yield 0.7, fatRet 1.0, abs 6): mass 800*0.7 = 560.0; fat 800*0.1/100*1.0 = 0.8, fat lost 0.0, kcal 800*77/100 - 9*0.0 = 616.0; absorbs 800*6/100 = 48.0 g
  //   sunflower_oil 60 g: absorbed fat, listed; L += 60
  //   ghee 20 g: absorbed fat, listed; L += 20
  //   A = min(capacity 48.0, listed 80.0) = 48.0
  //   sunflower_oil: 48.0*60/80.0 = 36.0 g absorbed: kcal 318.24, fat 36.0, satFat 3.6
  //   ghee: 48.0*20/80.0 = 12.0 g absorbed: kcal 105.12, fat 11.94, satFat 7.44
  //   W = 608.0 g; N = kcal 1039.36, protein 16.036, carbs 128.0, fat 48.74, satFat 11.28, fibre 17.6, solubleFibre 8.0, sugar 6.4, sodiumMg 48.24
  //   per 100 g cooked = N / W * 100
  {
    id: "potato_oil_ghee",
    title: "Shallow-fried potato in oil and ghee",
    tags: ["oil_absorption", "two_absorbed_fats"],
    variant: {
      method: "shallow_fried",
      ingredients: [
        { ingredientId: "potato", rawG: 800, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 60, isAbsorbedOil: true },
        { ingredientId: "ghee", rawG: 20, isAbsorbedOil: true },
      ],
    },
    expected: {
      per100g: {
        kcal: 170.947368,
        protein: 2.6375,
        carbs: 21.052632,
        fat: 8.016447,
        satFat: 1.855263,
        fibre: 2.894737,
        solubleFibre: 1.315789,
        sugar: 1.052632,
        sodiumMg: 7.934211,
      },
      batchCookedG: 608,
    },
  },
  // Grilled lamb leg
  //   lamb_leg 1000 g (grilled x red_meat: yield 0.7, fatRet 0.7, abs 0): mass 1000*0.7 = 700.0; fat 1000*18/100*0.7 = 126.0, fat lost 54.0, kcal 1000*230/100 - 9*54.0 = 1814.0
  //   W = 700.0 g; N = kcal 1814.0, protein 170.0, carbs 0.0, fat 126.0, satFat 56.0, fibre 0.0, solubleFibre 0.0, sugar 0.0, sodiumMg 600.0
  //   per 100 g cooked = N / W * 100
  {
    id: "grilled_lamb",
    title: "Grilled lamb leg",
    tags: ["fat_retention"],
    variant: {
      method: "grilled",
      ingredients: [{ ingredientId: "lamb_leg", rawG: 1000, isAbsorbedOil: false }],
    },
    expected: {
      per100g: {
        kcal: 259.142857,
        protein: 24.285714,
        carbs: 0,
        fat: 18,
        satFat: 8,
        fibre: 0,
        solubleFibre: 0,
        sugar: 0,
        sodiumMg: 85.714286,
      },
      batchCookedG: 700,
    },
  },
  // Roasted potatoes with oil and salt (known-bound zeros)
  //   potato 1000 g (roasted x starch: yield 0.75, fatRet 1.0, abs 0): mass 1000*0.75 = 750.0; fat 1000*0.1/100*1.0 = 1.0, fat lost 0.0, kcal 1000*77/100 - 9*0.0 = 770.0
  //   sunflower_oil 40 g (roasted x oil_fat: yield 1.0, fatRet 1.0, abs 0): mass 40*1.0 = 40.0; fat 40*100/100*1.0 = 40.0, fat lost 0.0, kcal 40*884/100 - 9*0.0 = 353.6
  //   salt 6 g (roasted x herb_spice: yield 1.0, fatRet 1.0, abs 0): mass 6*1.0 = 6.0; fat 6*0/100*1.0 = 0.0, fat lost 0.0, kcal 6*0/100 - 9*0.0 = 0.0
  //   W = 796.0 g; N = kcal 1123.6, protein 20.0, carbs 160.0, fat 41.0, satFat 4.3, fibre 22.0, solubleFibre 10.0, sugar 8.0, sodiumMg 2385.48
  //   per 100 g cooked = N / W * 100
  {
    id: "roasted_potatoes",
    title: "Roasted potatoes with oil and salt (known-bound zeros)",
    tags: ["known_bound_zero"],
    variant: {
      method: "roasted",
      ingredients: [
        { ingredientId: "potato", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "sunflower_oil", rawG: 40, isAbsorbedOil: false },
        { ingredientId: "salt", rawG: 6, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 141.155779,
        protein: 2.512563,
        carbs: 20.100503,
        fat: 5.150754,
        satFat: 0.540201,
        fibre: 2.763819,
        solubleFibre: 1.256281,
        sugar: 1.005025,
        sodiumMg: 299.683417,
      },
      batchCookedG: 796,
    },
  },
  // Raw cucumber-tomato salad with tahini
  //   cucumber 300 g (raw x vegetable: yield 1.0, fatRet 1.0, abs 0): mass 300*1.0 = 300.0; fat 300*0.1/100*1.0 = 0.3, fat lost 0.0, kcal 300*15/100 - 9*0.0 = 45.0
  //   tomato 300 g (raw x vegetable: yield 1.0, fatRet 1.0, abs 0): mass 300*1.0 = 300.0; fat 300*0.2/100*1.0 = 0.6, fat lost 0.0, kcal 300*18/100 - 9*0.0 = 54.0
  //   tahini 40 g (raw x nut_seed: yield 1.0, fatRet 1.0, abs 0): mass 40*1.0 = 40.0; fat 40*54/100*1.0 = 21.6, fat lost 0.0, kcal 40*595/100 - 9*0.0 = 238.0
  //   olive_oil 15 g (raw x oil_fat: yield 1.0, fatRet 1.0, abs 0): mass 15*1.0 = 15.0; fat 15*100/100*1.0 = 15.0, fat lost 0.0, kcal 15*884/100 - 9*0.0 = 132.6
  //   W = 655.0 g; N = kcal 469.6, protein 11.6, carbs 25.5, fat 37.5, satFat 5.31, fibre 8.82, solubleFibre 1.8, sugar 13.1, sodiumMg 35.3
  //   per 100 g cooked = N / W * 100
  {
    id: "raw_salad",
    title: "Raw cucumber-tomato salad with tahini",
    tags: ["raw"],
    variant: {
      method: "raw",
      ingredients: [
        { ingredientId: "cucumber", rawG: 300, isAbsorbedOil: false },
        { ingredientId: "tomato", rawG: 300, isAbsorbedOil: false },
        { ingredientId: "tahini", rawG: 40, isAbsorbedOil: false },
        { ingredientId: "olive_oil", rawG: 15, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 71.694656,
        protein: 1.770992,
        carbs: 3.89313,
        fat: 5.725191,
        satFat: 0.810687,
        fibre: 1.346565,
        solubleFibre: 0.274809,
        sugar: 2,
        sodiumMg: 5.389313,
      },
      batchCookedG: 655,
    },
  },
  // Sauteed zucchini and onion (zucchini sugar unknown)
  //   zucchini 500 g (sauteed x vegetable: yield 0.85, fatRet 1.0, abs 0): mass 500*0.85 = 425.0; fat 500*0.3/100*1.0 = 1.5, fat lost 0.0, kcal 500*17/100 - 9*0.0 = 85.0
  //   onion 100 g (sauteed x vegetable: yield 0.85, fatRet 1.0, abs 0): mass 100*0.85 = 85.0; fat 100*0.1/100*1.0 = 0.1, fat lost 0.0, kcal 100*40/100 - 9*0.0 = 40.0
  //   olive_oil 20 g (sauteed x oil_fat: yield 1.0, fatRet 1.0, abs 0): mass 20*1.0 = 20.0; fat 20*100/100*1.0 = 20.0, fat lost 0.0, kcal 20*884/100 - 9*0.0 = 176.8
  //   W = 530.0 g; N = kcal 301.8, protein 7.1, carbs 19.6, fat 21.6, satFat 3.24, fibre 6.7, solubleFibre 2.9, sugar null, sodiumMg 44.4
  //   per 100 g cooked = N / W * 100
  {
    id: "sauteed_zucchini",
    title: "Sauteed zucchini and onion (zucchini sugar unknown)",
    tags: ["unknown_nutrient"],
    variant: {
      method: "sauteed",
      ingredients: [
        { ingredientId: "zucchini", rawG: 500, isAbsorbedOil: false },
        { ingredientId: "onion", rawG: 100, isAbsorbedOil: false },
        { ingredientId: "olive_oil", rawG: 20, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 56.943396,
        protein: 1.339623,
        carbs: 3.698113,
        fat: 4.075472,
        satFat: 0.611321,
        fibre: 1.264151,
        solubleFibre: 0.54717,
        sugar: null,
        sodiumMg: 8.377358,
      },
      batchCookedG: 530,
    },
  },
  // Grilled chicken with black pepper (pepper soluble fibre unknown)
  //   chicken_breast 1000 g (grilled x poultry: yield 0.75, fatRet 0.85, abs 0): mass 1000*0.75 = 750.0; fat 1000*2.6/100*0.85 = 22.1, fat lost 3.9, kcal 1000*120/100 - 9*3.9 = 1164.9
  //   black_pepper 5 g (grilled x herb_spice: yield 1.0, fatRet 1.0, abs 0): mass 5*1.0 = 5.0; fat 5*3.3/100*1.0 = 0.165, fat lost 0.0, kcal 5*251/100 - 9*0.0 = 12.55
  //   W = 755.0 g; N = kcal 1177.45, protein 225.52, carbs 1.935, fat 22.265, satFat 5.17, fibre 1.265, solubleFibre null, sugar 0.03, sodiumMg 451.0
  //   per 100 g cooked = N / W * 100
  {
    id: "peppered_chicken",
    title: "Grilled chicken with black pepper (pepper soluble fibre unknown)",
    tags: ["unknown_nutrient", "grilled_vs_fried"],
    variant: {
      method: "grilled",
      ingredients: [
        { ingredientId: "chicken_breast", rawG: 1000, isAbsorbedOil: false },
        { ingredientId: "black_pepper", rawG: 5, isAbsorbedOil: false },
      ],
    },
    expected: {
      per100g: {
        kcal: 155.953642,
        protein: 29.870199,
        carbs: 0.256291,
        fat: 2.949007,
        satFat: 0.684768,
        fibre: 0.16755,
        solubleFibre: null,
        sugar: 0.003974,
        sodiumMg: 59.735099,
      },
      batchCookedG: 755,
    },
  },
];
