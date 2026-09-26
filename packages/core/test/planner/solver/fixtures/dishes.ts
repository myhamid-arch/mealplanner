// The leaf's own test dish set (ledger G4, BLD-8 R-16): multi-component dishes and adjusters written
// as reference batches of catalogue ingredients (data/ingredients.v1.json slugs). Their nutrition is
// computed with the 1.2.1 engine in ./build.ts. Serving ranges are cooked grams per plate.
import type { MethodKey } from "../../../../src/nutrition/index.js";
import type { ComponentRole, Portioning } from "../../../../src/types/index.js";

/** [slug, raw grams per batch, how it counts, yield override (cooked ÷ raw, BLD-8 R-12)]. */
export type LineSpec = [string, number, ("oil" | "absorbed" | "retained" | undefined)?, number?];

export type VariantSpec = {
  key: string;
  method: MethodKey;
  lines: LineSpec[];
  isDefault?: boolean;
};

export type ComponentSpec = {
  key: string;
  role: ComponentRole;
  portioning?: Portioning;
  min: number;
  max: number;
  def: number;
  step?: number;
  unitWeightG?: number;
  required?: boolean;
  variants: VariantSpec[];
};

export type DishSpec = {
  key: string;
  slots: string[];
  packable: boolean;
  cold: boolean;
  components: ComponentSpec[];
};

const WATER = "water";

// Reusable components ---------------------------------------------------------------------------

const basmati = (max = 350): ComponentSpec => ({
  key: "rice",
  role: "carb",
  min: 50,
  max,
  def: 150,
  variants: [
    {
      key: "boiled",
      method: "boiled",
      lines: [
        ["basmati-rice", 500],
        [WATER, 900, "absorbed"],
      ],
      isDefault: true,
    },
    {
      key: "pilaf",
      method: "boiled",
      lines: [
        ["basmati-rice", 500],
        ["vegetable-stock", 900, "absorbed"],
        ["butter", 20],
        ["onion", 80],
      ],
    },
  ],
});

const salad = (required = false): ComponentSpec => ({
  key: "salad",
  role: "vegetable",
  min: 40,
  max: 250,
  def: 100,
  required,
  variants: [
    {
      key: "plain",
      method: "raw",
      lines: [
        ["cucumber", 300],
        ["tomato", 300],
        ["lettuce-romaine", 200],
        ["lemon-juice", 30],
      ],
      isDefault: true,
    },
    {
      key: "dressed",
      method: "raw",
      lines: [
        ["cucumber", 300],
        ["tomato", 300],
        ["lettuce-romaine", 200],
        ["lemon-juice", 30],
        ["olive-oil", 40],
      ],
    },
  ],
});

const dressing = (slug = "olive-oil"): ComponentSpec => ({
  key: "dressing",
  role: "fat",
  min: 5,
  max: 20,
  def: 10,
  required: false,
  variants: [{ key: "plain", method: "raw", lines: [[slug, 100]], isDefault: true }],
});

const khubz = (required = false): ComponentSpec => ({
  key: "bread",
  role: "carb",
  min: 30,
  max: 120,
  def: 60,
  required,
  variants: [
    { key: "white", method: "raw", lines: [["khubz", 100]], isDefault: true },
    { key: "wholemeal", method: "raw", lines: [["khubz-wholemeal", 100]] },
  ],
});

export const DISHES: DishSpec[] = [
  {
    key: "chicken_rice_salad",
    slots: ["lunch", "dinner", "packed_work_lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "chicken",
        role: "protein",
        min: 80,
        max: 300,
        def: 180,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["chicken-breast", 1000],
              ["olive-oil", 10],
              ["garlic", 10],
            ],
            isDefault: true,
          },
          {
            key: "seared",
            method: "pan_seared",
            lines: [
              ["chicken-breast", 1000],
              ["olive-oil", 30],
              ["garlic", 10],
            ],
          },
          {
            key: "breaded",
            method: "breaded_fried",
            lines: [
              ["chicken-breast", 1000],
              ["breadcrumbs", 120],
              ["egg", 100],
              ["sunflower-oil", 300, "oil"],
            ],
          },
        ],
      },
      basmati(),
      salad(),
    ],
  },
  {
    key: "salmon_sweet_potato_broccoli",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "salmon",
        role: "protein",
        min: 80,
        max: 250,
        def: 160,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["salmon", 1000],
              ["lemon-juice", 20],
            ],
            isDefault: true,
          },
          {
            key: "baked",
            method: "baked",
            lines: [
              ["salmon", 1000],
              ["olive-oil", 15],
              ["dill-fresh", 10],
            ],
          },
        ],
      },
      {
        key: "sweet_potato",
        role: "carb",
        min: 60,
        max: 350,
        def: 170,
        variants: [
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["sweet-potato", 1000],
              ["olive-oil", 20],
            ],
            isDefault: true,
          },
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["sweet-potato", 1000],
              [WATER, 1500, "absorbed"],
            ],
          },
        ],
      },
      {
        key: "broccoli",
        role: "vegetable",
        min: 50,
        max: 250,
        def: 150,
        variants: [
          { key: "steamed", method: "steamed", lines: [["broccoli", 500]], isDefault: true },
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["broccoli", 500],
              ["olive-oil", 15],
            ],
          },
        ],
      },
    ],
  },
  {
    key: "kofta_bulgur_tahini",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "kofta",
        role: "protein",
        min: 80,
        max: 250,
        def: 170,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["beef-mince-lean", 1000],
              ["onion", 100],
              ["parsley", 30],
              ["cumin", 5],
            ],
            isDefault: true,
          },
          {
            key: "seared",
            method: "pan_seared",
            lines: [
              ["beef-mince-lean", 1000],
              ["onion", 100],
              ["parsley", 30],
              ["cumin", 5],
              ["olive-oil", 30],
            ],
          },
        ],
      },
      {
        key: "bulgur",
        role: "carb",
        min: 50,
        max: 300,
        def: 140,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["bulgur", 400],
              [WATER, 800, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "tahini_sauce",
        role: "sauce",
        min: 10,
        max: 60,
        def: 25,
        required: false,
        variants: [
          {
            key: "raw",
            method: "raw",
            lines: [
              ["tahini", 100],
              ["lemon-juice", 40],
              ["garlic", 5],
              [WATER, 60, "retained"],
            ],
            isDefault: true,
          },
        ],
      },
      salad(),
    ],
  },
  {
    key: "lentil_soup_bread",
    slots: ["lunch", "dinner"],
    packable: true,
    cold: false,
    components: [
      {
        key: "soup",
        role: "protein",
        min: 150,
        max: 500,
        def: 300,
        step: 10,
        variants: [
          {
            key: "stewed",
            method: "stewed",
            lines: [
              ["lentils-red", 300],
              ["onion", 150],
              ["carrot", 150],
              ["olive-oil", 20],
              ["vegetable-stock", 500, "retained"],
            ],
            isDefault: true,
          },
        ],
      },
      khubz(),
      {
        key: "yogurt",
        role: "side",
        min: 30,
        max: 200,
        def: 80,
        required: false,
        variants: [
          { key: "plain", method: "raw", lines: [["greek-yogurt-nonfat", 100]], isDefault: true },
        ],
      },
    ],
  },
  {
    key: "chicken_shawarma_plate",
    slots: ["lunch", "dinner", "packed_work_lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "chicken",
        role: "protein",
        min: 80,
        max: 280,
        def: 170,
        variants: [
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["chicken-thigh", 1000],
              ["yogurt-plain-low-fat", 100],
              ["olive-oil", 20],
              ["paprika", 5],
            ],
            isDefault: true,
          },
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["chicken-breast", 1000],
              ["yogurt-plain-low-fat", 100],
              ["paprika", 5],
            ],
          },
        ],
      },
      khubz(true),
      {
        key: "garlic_sauce",
        role: "sauce",
        min: 10,
        max: 60,
        def: 25,
        required: false,
        variants: [
          {
            key: "yogurt",
            method: "raw",
            lines: [
              ["greek-yogurt-low-fat", 200],
              ["garlic", 15],
              ["lemon-juice", 10],
            ],
            isDefault: true,
          },
          {
            key: "toum",
            method: "blended",
            lines: [
              ["garlic", 50],
              ["sunflower-oil", 150],
              ["lemon-juice", 30],
            ],
          },
        ],
      },
      {
        key: "pickles",
        role: "vegetable",
        min: 20,
        max: 120,
        def: 50,
        required: false,
        variants: [
          {
            key: "mixed",
            method: "raw",
            lines: [
              ["pickled-cucumber", 100],
              ["tomato", 100],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "pasta_bolognese",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "pasta",
        role: "carb",
        min: 60,
        max: 350,
        def: 150,
        variants: [
          {
            key: "white",
            method: "boiled",
            lines: [
              ["pasta-dry", 500],
              [WATER, 3000, "absorbed"],
            ],
            isDefault: true,
          },
          {
            key: "wholewheat",
            method: "boiled",
            lines: [
              ["pasta-wholewheat-dry", 500],
              [WATER, 3000, "absorbed"],
            ],
          },
        ],
      },
      {
        key: "sauce",
        role: "protein",
        min: 80,
        max: 300,
        def: 220,
        variants: [
          {
            key: "stewed",
            method: "stewed",
            lines: [
              ["beef-mince-lean", 600],
              ["tomato-passata", 700],
              ["onion", 150],
              ["carrot", 100],
              ["olive-oil", 20],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "parmesan",
        role: "garnish",
        min: 5,
        max: 25,
        def: 10,
        required: false,
        variants: [{ key: "grated", method: "raw", lines: [["parmesan", 100]], isDefault: true }],
      },
    ],
  },
  {
    key: "shrimp_stir_fry_rice",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "shrimp",
        role: "protein",
        min: 80,
        max: 280,
        def: 200,
        variants: [
          {
            key: "stir_fried",
            method: "stir_fried",
            lines: [
              ["shrimp", 1000],
              ["canola-oil", 30],
              ["garlic", 20],
              ["soy-sauce", 30],
            ],
            isDefault: true,
          },
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["shrimp", 1000],
              ["garlic", 20],
              ["lemon-juice", 20],
            ],
          },
        ],
      },
      {
        key: "rice",
        role: "carb",
        min: 50,
        max: 350,
        def: 140,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["rice-white-long-grain", 500],
              [WATER, 900, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "vegetables",
        role: "vegetable",
        min: 50,
        max: 250,
        def: 120,
        variants: [
          {
            key: "stir_fried",
            method: "stir_fried",
            lines: [
              ["mixed-vegetables-frozen", 600],
              ["canola-oil", 20],
            ],
            isDefault: true,
          },
          { key: "steamed", method: "steamed", lines: [["mixed-vegetables-frozen", 600]] },
        ],
      },
    ],
  },
  {
    key: "eggs_toast_avocado",
    slots: ["breakfast"],
    packable: false,
    cold: false,
    components: [
      {
        key: "eggs",
        role: "protein",
        portioning: "unit",
        unitWeightG: 50,
        min: 50,
        max: 200,
        def: 100,
        variants: [
          { key: "boiled", method: "boiled", lines: [["egg", 600]], isDefault: true },
          {
            key: "fried",
            method: "pan_seared",
            lines: [
              ["egg", 600],
              ["butter", 30],
            ],
          },
        ],
      },
      {
        key: "toast",
        role: "carb",
        min: 30,
        max: 150,
        def: 60,
        variants: [
          { key: "wholemeal", method: "raw", lines: [["bread-wholemeal", 100]], isDefault: true },
          { key: "multigrain", method: "raw", lines: [["bread-multigrain", 100]] },
        ],
      },
      {
        key: "avocado",
        role: "fat",
        min: 20,
        max: 100,
        def: 30,
        required: false,
        variants: [
          {
            key: "sliced",
            method: "raw",
            lines: [
              ["avocado", 100],
              ["lemon-juice", 5],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "egg_whites",
        role: "protein",
        min: 0,
        max: 200,
        def: 100,
        required: false,
        variants: [
          { key: "scrambled", method: "pan_seared", lines: [["egg-white", 500]], isDefault: true },
        ],
      },
    ],
  },
  {
    key: "oat_porridge_banana",
    slots: ["breakfast"],
    packable: false,
    cold: false,
    components: [
      {
        key: "porridge",
        role: "carb",
        min: 100,
        max: 450,
        def: 200,
        step: 10,
        variants: [
          {
            key: "milk",
            method: "boiled",
            lines: [
              ["oats-rolled", 100],
              ["milk-low-fat", 400, "retained"],
            ],
            isDefault: true,
          },
          {
            key: "water",
            method: "boiled",
            lines: [
              ["oats-rolled", 100],
              [WATER, 400, "retained"],
            ],
          },
        ],
      },
      {
        key: "banana",
        role: "side",
        min: 0,
        max: 150,
        def: 60,
        required: false,
        variants: [{ key: "sliced", method: "raw", lines: [["banana", 100]], isDefault: true }],
      },
      {
        key: "yogurt",
        role: "protein",
        min: 50,
        max: 300,
        def: 170,
        variants: [
          { key: "nonfat", method: "raw", lines: [["greek-yogurt-nonfat", 100]], isDefault: true },
        ],
      },
      {
        key: "almonds",
        role: "fat",
        min: 5,
        max: 30,
        def: 10,
        required: false,
        variants: [{ key: "raw", method: "raw", lines: [["almonds", 100]], isDefault: true }],
      },
    ],
  },
  {
    key: "yogurt_granola_bowl",
    slots: ["breakfast", "snack"],
    packable: true,
    cold: true,
    components: [
      {
        key: "yogurt",
        role: "protein",
        min: 100,
        max: 400,
        def: 250,
        variants: [
          { key: "nonfat", method: "raw", lines: [["greek-yogurt-nonfat", 100]], isDefault: true },
          { key: "lowfat", method: "raw", lines: [["greek-yogurt-low-fat", 100]] },
        ],
      },
      {
        key: "granola",
        role: "carb",
        min: 15,
        max: 100,
        def: 40,
        variants: [{ key: "plain", method: "raw", lines: [["granola", 100]], isDefault: true }],
      },
      {
        key: "berries",
        role: "side",
        min: 0,
        max: 200,
        def: 80,
        required: false,
        variants: [
          { key: "blueberries", method: "raw", lines: [["blueberries", 100]], isDefault: true },
          { key: "strawberries", method: "raw", lines: [["strawberries", 100]] },
        ],
      },
      {
        key: "honey",
        role: "garnish",
        min: 5,
        max: 25,
        def: 5,
        required: false,
        variants: [{ key: "drizzle", method: "raw", lines: [["honey", 100]], isDefault: true }],
      },
    ],
  },
  {
    key: "hammour_rice_salsa",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "fish",
        role: "protein",
        min: 80,
        max: 280,
        def: 190,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["hammour", 1000],
              ["lemon-juice", 20],
              ["cumin", 5],
            ],
            isDefault: true,
          },
          {
            key: "fried",
            method: "deep_fried",
            lines: [
              ["hammour", 1000],
              ["flour-wheat-white", 60],
              ["sunflower-oil", 400, "oil"],
            ],
          },
        ],
      },
      basmati(),
      {
        key: "salsa",
        role: "vegetable",
        min: 30,
        max: 200,
        def: 80,
        required: false,
        variants: [
          {
            key: "fresh",
            method: "raw",
            lines: [
              ["tomato", 400],
              ["red-onion", 80],
              ["coriander-fresh", 20],
              ["lime-juice", 30],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "lamb_stew_couscous",
    slots: ["dinner"],
    packable: true,
    cold: false,
    components: [
      {
        key: "stew",
        role: "protein",
        min: 120,
        max: 400,
        def: 260,
        step: 10,
        variants: [
          {
            key: "stewed",
            method: "stewed",
            lines: [
              ["lamb-leg", 800],
              ["tomato-canned", 400],
              ["onion", 150],
              ["carrot", 150],
              ["zucchini", 200],
              [WATER, 400, "retained"],
            ],
            isDefault: true,
          },
          {
            key: "slow",
            method: "slow_cooked",
            lines: [
              ["lamb-leg", 800],
              ["tomato-canned", 400],
              ["onion", 150],
              ["carrot", 150],
              ["zucchini", 200],
              [WATER, 400, "retained"],
            ],
          },
        ],
      },
      {
        key: "couscous",
        role: "carb",
        min: 50,
        max: 300,
        def: 150,
        variants: [
          {
            key: "steamed",
            method: "boiled",
            lines: [
              ["couscous", 400],
              [WATER, 500, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "yogurt",
        role: "side",
        min: 30,
        max: 150,
        def: 60,
        required: false,
        variants: [
          { key: "plain", method: "raw", lines: [["yogurt-plain-low-fat", 100]], isDefault: true },
        ],
      },
    ],
  },
  {
    key: "turkey_burger_salad",
    slots: ["lunch", "dinner"],
    packable: false,
    cold: false,
    components: [
      {
        key: "patty",
        role: "protein",
        min: 90,
        max: 270,
        def: 170,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["turkey-mince", 1000],
              ["onion", 80],
              ["black-pepper", 3],
            ],
            isDefault: true,
          },
          {
            key: "seared",
            method: "pan_seared",
            lines: [
              ["turkey-mince", 1000],
              ["onion", 80],
              ["olive-oil", 25],
            ],
          },
        ],
      },
      {
        key: "bun",
        role: "carb",
        portioning: "unit",
        unitWeightG: 60,
        min: 60,
        max: 120,
        def: 60,
        required: false,
        variants: [{ key: "plain", method: "raw", lines: [["burger-bun", 100]], isDefault: true }],
      },
      {
        key: "wedges",
        role: "carb",
        min: 0,
        max: 300,
        def: 100,
        required: false,
        variants: [
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["potato", 1000],
              ["olive-oil", 30],
            ],
            isDefault: true,
          },
        ],
      },
      salad(),
    ],
  },
  {
    key: "chickpea_curry_rice_raita",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "curry",
        role: "protein",
        min: 120,
        max: 400,
        def: 220,
        step: 10,
        variants: [
          {
            key: "light",
            method: "stewed",
            lines: [
              ["chickpeas-canned", 800, undefined, 1],
              ["tomato-canned", 400],
              ["onion", 150],
              ["curry-powder", 15],
              ["vegetable-oil", 30],
              [WATER, 200, "retained"],
            ],
            isDefault: true,
          },
          {
            key: "creamy",
            method: "stewed",
            lines: [
              ["chickpeas-canned", 800, undefined, 1],
              ["tomato-canned", 300],
              ["onion", 150],
              ["curry-powder", 15],
              ["coconut-milk", 250],
              [WATER, 100, "retained"],
            ],
          },
        ],
      },
      basmati(300),
      {
        key: "raita",
        role: "side",
        min: 40,
        max: 250,
        def: 80,
        required: false,
        variants: [
          {
            key: "cucumber",
            method: "raw",
            lines: [
              ["greek-yogurt-nonfat", 300],
              ["cucumber", 150],
              ["mint-fresh", 10],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "tuna_salad_wrap",
    slots: ["lunch", "packed_work_lunch", "packed_school_lunch"],
    packable: true,
    cold: true,
    components: [
      {
        key: "tuna",
        role: "protein",
        min: 60,
        max: 250,
        def: 150,
        variants: [
          {
            key: "light",
            method: "raw",
            lines: [
              ["tuna-canned-water", 300],
              ["greek-yogurt-nonfat", 60],
              ["red-onion", 30],
              ["lemon-juice", 10],
            ],
            isDefault: true,
          },
          {
            key: "mayo",
            method: "raw",
            lines: [
              ["tuna-canned-water", 300],
              ["mayonnaise", 50],
              ["red-onion", 30],
            ],
          },
        ],
      },
      {
        key: "wrap",
        role: "carb",
        min: 40,
        max: 160,
        def: 70,
        variants: [
          { key: "flour", method: "raw", lines: [["tortilla-flour", 100]], isDefault: true },
        ],
      },
      salad(),
    ],
  },
  {
    key: "steak_potato_beans",
    slots: ["dinner"],
    packable: false,
    cold: false,
    components: [
      {
        key: "steak",
        role: "protein",
        min: 100,
        max: 300,
        def: 180,
        variants: [
          { key: "grilled", method: "grilled", lines: [["beef-sirloin", 1000]], isDefault: true },
          {
            key: "seared",
            method: "pan_seared",
            lines: [
              ["beef-sirloin", 1000],
              ["butter", 30],
            ],
          },
        ],
      },
      {
        key: "potato",
        role: "carb",
        min: 60,
        max: 400,
        def: 170,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["potato", 1000],
              [WATER, 1500, "absorbed"],
            ],
            isDefault: true,
          },
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["potato", 1000],
              ["olive-oil", 30],
            ],
          },
        ],
      },
      {
        key: "green_beans",
        role: "vegetable",
        min: 50,
        max: 250,
        def: 120,
        variants: [
          { key: "steamed", method: "steamed", lines: [["green-beans", 500]], isDefault: true },
        ],
      },
    ],
  },
  {
    key: "chicken_fajitas",
    slots: ["dinner", "lunch"],
    packable: false,
    cold: false,
    components: [
      {
        key: "chicken",
        role: "protein",
        min: 80,
        max: 280,
        def: 170,
        variants: [
          {
            key: "stir_fried",
            method: "stir_fried",
            lines: [
              ["chicken-breast", 1000],
              ["vegetable-oil", 25],
              ["paprika", 8],
              ["cumin", 5],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "tortillas",
        role: "carb",
        min: 40,
        max: 200,
        def: 90,
        variants: [
          { key: "flour", method: "raw", lines: [["tortilla-flour", 100]], isDefault: true },
          { key: "corn", method: "raw", lines: [["tortilla-corn", 100]] },
        ],
      },
      {
        key: "peppers",
        role: "vegetable",
        min: 50,
        max: 250,
        def: 120,
        variants: [
          {
            key: "sauteed",
            method: "sauteed",
            lines: [
              ["bell-pepper-red", 400],
              ["onion", 200],
              ["vegetable-oil", 15],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "sour_cream",
        role: "sauce",
        min: 10,
        max: 60,
        def: 20,
        required: false,
        variants: [{ key: "plain", method: "raw", lines: [["sour-cream", 100]], isDefault: true }],
      },
    ],
  },
  {
    key: "tofu_noodle_stir_fry",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "tofu",
        role: "protein",
        min: 100,
        max: 350,
        def: 220,
        variants: [
          {
            key: "stir_fried",
            method: "stir_fried",
            lines: [
              ["tofu-firm", 1000],
              ["canola-oil", 30],
              ["soy-sauce", 40],
            ],
            isDefault: true,
          },
          {
            key: "fried",
            method: "deep_fried",
            lines: [
              ["tofu-firm", 1000],
              ["cornflour", 40],
              ["canola-oil", 400, "oil"],
            ],
          },
        ],
      },
      {
        key: "noodles",
        role: "carb",
        min: 60,
        max: 300,
        def: 160,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["rice-noodles-dry", 400],
              [WATER, 2000, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "greens",
        role: "vegetable",
        min: 50,
        max: 250,
        def: 110,
        variants: [
          {
            key: "stir_fried",
            method: "stir_fried",
            lines: [
              ["broccoli", 300],
              ["bell-pepper-red", 200],
              ["canola-oil", 15],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "roast_chicken_freekeh",
    slots: ["dinner", "lunch", "packed_work_lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "chicken",
        role: "protein",
        min: 80,
        max: 300,
        def: 180,
        variants: [
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["chicken-breast", 1000],
              ["olive-oil", 20],
              ["allspice", 5],
            ],
            isDefault: true,
          },
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["chicken-breast", 1000],
              ["allspice", 5],
            ],
          },
        ],
      },
      {
        key: "freekeh",
        role: "carb",
        min: 50,
        max: 300,
        def: 140,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["freekeh", 400],
              ["chicken-stock", 900, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      salad(),
      dressing(),
    ],
  },
  {
    key: "cod_quinoa_spinach",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "cod",
        role: "protein",
        min: 100,
        max: 320,
        def: 210,
        variants: [
          {
            key: "baked",
            method: "baked",
            lines: [
              ["cod", 1000],
              ["olive-oil", 20],
              ["lemon-juice", 20],
            ],
            isDefault: true,
          },
          {
            key: "poached",
            method: "poached",
            lines: [
              ["cod", 1000],
              ["lemon-juice", 20],
            ],
          },
        ],
      },
      {
        key: "quinoa",
        role: "carb",
        min: 50,
        max: 300,
        def: 140,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["quinoa", 400],
              [WATER, 800, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "spinach",
        role: "vegetable",
        min: 40,
        max: 200,
        def: 90,
        variants: [
          {
            key: "sauteed",
            method: "sauteed",
            lines: [
              ["spinach", 500],
              ["olive-oil", 15],
              ["garlic", 10],
            ],
            isDefault: true,
          },
          { key: "steamed", method: "steamed", lines: [["spinach", 500]] },
        ],
      },
    ],
  },
  {
    key: "shakshuka_bread",
    slots: ["breakfast", "lunch"],
    packable: false,
    cold: false,
    components: [
      {
        key: "shakshuka",
        role: "protein",
        min: 150,
        max: 450,
        def: 250,
        step: 10,
        variants: [
          {
            key: "stewed",
            method: "stewed",
            lines: [
              ["egg", 400],
              ["tomato-canned", 600],
              ["bell-pepper-red", 200],
              ["onion", 100],
              ["olive-oil", 30],
              ["cumin", 5],
            ],
            isDefault: true,
          },
        ],
      },
      khubz(),
      {
        key: "feta",
        role: "garnish",
        min: 10,
        max: 50,
        def: 20,
        required: false,
        variants: [{ key: "crumbled", method: "raw", lines: [["feta", 100]], isDefault: true }],
      },
    ],
  },
  {
    key: "falafel_hummus_plate",
    slots: ["lunch", "dinner", "packed_school_lunch"],
    packable: true,
    cold: true,
    components: [
      {
        key: "falafel",
        role: "protein",
        min: 60,
        max: 250,
        def: 120,
        variants: [
          {
            key: "fried",
            method: "deep_fried",
            lines: [
              ["chickpeas-dried", 500],
              ["onion", 100],
              ["parsley", 40],
              ["sesame-seeds", 10],
              ["sunflower-oil", 500, "oil"],
            ],
            isDefault: true,
          },
          {
            key: "baked",
            method: "baked",
            lines: [
              ["chickpeas-dried", 500],
              ["onion", 100],
              ["parsley", 40],
              ["olive-oil", 30],
            ],
          },
        ],
      },
      {
        key: "hummus",
        role: "sauce",
        min: 20,
        max: 120,
        def: 50,
        required: false,
        variants: [{ key: "classic", method: "raw", lines: [["hummus", 100]], isDefault: true }],
      },
      salad(),
      khubz(),
    ],
  },
  {
    key: "kingfish_curry_rice",
    slots: ["dinner"],
    packable: true,
    cold: false,
    components: [
      {
        key: "curry",
        role: "protein",
        min: 120,
        max: 380,
        def: 260,
        step: 10,
        variants: [
          {
            key: "tomato",
            method: "stewed",
            lines: [
              ["kingfish", 800],
              ["tomato-canned", 400],
              ["onion", 150],
              ["curry-powder", 15],
              ["vegetable-oil", 25],
              ["tamarind", 20],
            ],
            isDefault: true,
          },
          {
            key: "coconut",
            method: "stewed",
            lines: [
              ["kingfish", 800],
              ["tomato-canned", 250],
              ["onion", 150],
              ["curry-powder", 15],
              ["coconut-milk", 200],
            ],
          },
        ],
      },
      basmati(),
      {
        key: "okra",
        role: "vegetable",
        min: 40,
        max: 200,
        def: 90,
        required: false,
        variants: [
          {
            key: "sauteed",
            method: "sauteed",
            lines: [
              ["okra", 500],
              ["tomato", 150],
              ["vegetable-oil", 15],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "sea_bream_roast_veg_bulgur",
    slots: ["dinner", "lunch"],
    packable: true,
    cold: false,
    components: [
      {
        key: "fish",
        role: "protein",
        min: 100,
        max: 300,
        def: 190,
        variants: [
          {
            key: "grilled",
            method: "grilled",
            lines: [
              ["sea-bream", 1000],
              ["lemon-juice", 20],
            ],
            isDefault: true,
          },
          {
            key: "baked",
            method: "baked",
            lines: [
              ["sea-bream", 1000],
              ["olive-oil", 20],
              ["garlic", 10],
            ],
          },
        ],
      },
      {
        key: "vegetables",
        role: "vegetable",
        min: 60,
        max: 300,
        def: 150,
        variants: [
          {
            key: "roasted",
            method: "roasted",
            lines: [
              ["zucchini", 300],
              ["eggplant", 300],
              ["bell-pepper-red", 200],
              ["olive-oil", 30],
            ],
            isDefault: true,
          },
        ],
      },
      {
        key: "bulgur",
        role: "carb",
        min: 50,
        max: 300,
        def: 140,
        variants: [
          {
            key: "boiled",
            method: "boiled",
            lines: [
              ["bulgur", 400],
              [WATER, 800, "absorbed"],
            ],
            isDefault: true,
          },
        ],
      },
    ],
  },
  {
    key: "cottage_cheese_fruit_rice_cakes",
    slots: ["snack", "breakfast"],
    packable: true,
    cold: true,
    components: [
      {
        key: "cottage_cheese",
        role: "protein",
        min: 50,
        max: 300,
        def: 150,
        variants: [
          { key: "plain", method: "raw", lines: [["cottage-cheese", 100]], isDefault: true },
        ],
      },
      {
        key: "fruit",
        role: "side",
        min: 50,
        max: 250,
        def: 120,
        variants: [
          { key: "apple", method: "raw", lines: [["apple", 100]], isDefault: true },
          { key: "pineapple", method: "raw", lines: [["pineapple", 100]] },
        ],
      },
      {
        key: "rice_cakes",
        role: "carb",
        portioning: "unit",
        unitWeightG: 9,
        min: 0,
        max: 36,
        def: 18,
        required: false,
        variants: [{ key: "plain", method: "raw", lines: [["rice-cakes", 100]], isDefault: true }],
      },
    ],
  },
];

/** PLN-6 adjusters: single-component dishes with role `adjuster`. */
export type AdjusterSpec = {
  key: string;
  packable: boolean;
  cold: boolean;
  min: number;
  max: number;
  def: number;
  step?: number;
  variants: VariantSpec[];
};

export const ADJUSTERS: AdjusterSpec[] = [
  {
    key: "greek_yogurt_0",
    packable: true,
    cold: true,
    min: 50,
    max: 250,
    def: 150,
    variants: [
      { key: "plain", method: "raw", lines: [["greek-yogurt-nonfat", 100]], isDefault: true },
    ],
  },
  {
    key: "egg_whites",
    packable: true,
    cold: true,
    min: 60,
    max: 300,
    def: 120,
    variants: [{ key: "boiled", method: "boiled", lines: [["egg-white", 500]], isDefault: true }],
  },
  {
    key: "cottage_cheese",
    packable: true,
    cold: true,
    min: 50,
    max: 250,
    def: 100,
    variants: [{ key: "plain", method: "raw", lines: [["cottage-cheese", 100]], isDefault: true }],
  },
  {
    key: "olive_oil",
    packable: true,
    cold: true,
    min: 5,
    max: 15,
    def: 10,
    variants: [{ key: "plain", method: "raw", lines: [["olive-oil", 100]], isDefault: true }],
  },
  {
    key: "apple",
    packable: true,
    cold: true,
    min: 80,
    max: 200,
    def: 150,
    variants: [{ key: "whole", method: "raw", lines: [["apple", 100]], isDefault: true }],
  },
  {
    key: "banana",
    packable: true,
    cold: true,
    min: 60,
    max: 150,
    def: 110,
    variants: [{ key: "whole", method: "raw", lines: [["banana", 100]], isDefault: true }],
  },
  {
    key: "dates",
    packable: true,
    cold: true,
    min: 15,
    max: 60,
    def: 30,
    variants: [{ key: "dried", method: "raw", lines: [["dates-dried", 100]], isDefault: true }],
  },
  {
    key: "rice_cakes",
    packable: true,
    cold: true,
    min: 9,
    max: 36,
    def: 18,
    step: 9,
    variants: [{ key: "plain", method: "raw", lines: [["rice-cakes", 100]], isDefault: true }],
  },
  {
    key: "cucumber_tomato_salad",
    packable: true,
    cold: true,
    min: 50,
    max: 200,
    def: 100,
    variants: [
      {
        key: "plain",
        method: "raw",
        lines: [
          ["cucumber", 200],
          ["tomato", 200],
        ],
        isDefault: true,
      },
    ],
  },
  {
    key: "labneh",
    packable: true,
    cold: true,
    min: 30,
    max: 120,
    def: 60,
    variants: [{ key: "plain", method: "raw", lines: [["labneh", 100]], isDefault: true }],
  },
  {
    key: "grilled_chicken_side",
    packable: false,
    cold: false,
    min: 50,
    max: 150,
    def: 80,
    variants: [
      { key: "grilled", method: "grilled", lines: [["chicken-breast", 1000]], isDefault: true },
    ],
  },
];
