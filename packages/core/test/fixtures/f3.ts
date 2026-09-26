// F3 — stress: 8 members (5 targeted), 10 slots including 2 custom, weekday presets, 30 days of
// synthetic reviews (11-build-plan §2, BLD-2). Reviews come from a seeded generator, so F3 is the
// same on every load.
import type { FixtureInput } from "../../src/types/index.js";

type FixtureDishInput = NonNullable<FixtureInput["dishes"]>[number];
type FixtureReviewInput = NonNullable<FixtureInput["reviews"]>[number];

const target = (kcal: number, proteinG: number, carbsG: number, fatG: number) => ({
  kcal,
  proteinG,
  carbsG,
  fatG,
});

const dishes: FixtureDishInput[] = [
  {
    slug: "chicken_rice_plate",
    name: "Chicken, rice and chopped salad",
    description: "Lemon-garlic chicken with basmati rice, chopped salad and yogurt-garlic sauce.",
    cuisine: "levantine",
    slotKeys: ["lunch", "dinner", "packed_work_lunch"],
    flavourTags: ["garlicky", "fresh"],
    isPackable: true,
    servedColdOk: false,
    components: [
      {
        name: "Chicken",
        role: "protein",
        portioning: "continuous",
        minServingG: 80,
        maxServingG: 300,
        defaultServingG: 140,
        required: true,
        variants: [
          {
            method: "grilled",
            label: "Grilled",
            isDefault: true,
            steps: [
              "Marinate the chicken in lemon, garlic and 10 g oil for 30 minutes.",
              "Grill at 230 °C for 6 minutes per side.",
            ],
            ingredients: [
              { slug: "chicken_breast", rawGPerBatch: 1300 },
              { slug: "lemon_juice", rawGPerBatch: 40, roleNote: "marinade" },
              { slug: "garlic", rawGPerBatch: 15, roleNote: "marinade" },
              { slug: "olive_oil", rawGPerBatch: 10, roleNote: "marinade" },
            ],
          },
          {
            method: "baked",
            label: "Oven-baked",
            isDefault: false,
            steps: ["Marinate as for grilled.", "Bake at 200 °C for 22 minutes to 74 °C inside."],
            ingredients: [
              { slug: "chicken_breast", rawGPerBatch: 1350 },
              { slug: "lemon_juice", rawGPerBatch: 40, roleNote: "marinade" },
              { slug: "garlic", rawGPerBatch: 15, roleNote: "marinade" },
              { slug: "olive_oil", rawGPerBatch: 10, roleNote: "marinade" },
            ],
          },
        ],
      },
      {
        name: "Basmati rice",
        role: "carb",
        portioning: "continuous",
        minServingG: 0,
        maxServingG: 350,
        defaultServingG: 150,
        required: false,
        variants: [
          {
            method: "boiled",
            label: "Steamed rice",
            isDefault: true,
            steps: [
              "Rinse the rice.",
              "Cook 1 : 1.5 with water, covered, 12 minutes; rest 10 minutes.",
            ],
            ingredients: [
              { slug: "basmati_rice", rawGPerBatch: 360 },
              { slug: "water", rawGPerBatch: 540, cookingLiquid: "absorbed" },
            ],
          },
        ],
      },
      {
        name: "Chopped salad",
        role: "vegetable",
        portioning: "continuous",
        minServingG: 0,
        maxServingG: 250,
        defaultServingG: 100,
        required: false,
        variants: [
          {
            method: "raw",
            label: "Fresh",
            isDefault: true,
            steps: [
              "Dice tomato and cucumber, shred the lettuce.",
              "Dress with lemon and 15 g olive oil per kg.",
            ],
            ingredients: [
              { slug: "tomato", rawGPerBatch: 400 },
              { slug: "cucumber", rawGPerBatch: 350 },
              { slug: "lettuce_romaine", rawGPerBatch: 220 },
              { slug: "lemon_juice", rawGPerBatch: 15 },
              { slug: "olive_oil", rawGPerBatch: 15 },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "salmon_potatoes",
    name: "Salmon, potatoes and broccoli",
    description: "Salmon three ways with roasted or boiled potatoes and steamed broccoli.",
    cuisine: "british",
    slotKeys: ["dinner"],
    flavourTags: ["savoury"],
    isPackable: false,
    servedColdOk: false,
    components: [
      {
        name: "Salmon",
        role: "protein",
        portioning: "continuous",
        minServingG: 80,
        maxServingG: 250,
        defaultServingG: 130,
        required: true,
        variants: [
          {
            method: "grilled",
            label: "Grilled",
            isDefault: true,
            steps: ["Season the fillets.", "Grill skin-side down at 220 °C for 8 minutes."],
            ingredients: [
              { slug: "salmon_fillet", rawGPerBatch: 1250 },
              { slug: "salt", rawGPerBatch: 6 },
            ],
          },
          {
            method: "pan_seared",
            label: "Pan-seared",
            isDefault: false,
            steps: [
              "Heat 20 g oil in a steel pan.",
              "Sear skin-side down 5 minutes, turn, 2 minutes.",
            ],
            ingredients: [
              { slug: "salmon_fillet", rawGPerBatch: 1220 },
              { slug: "olive_oil", rawGPerBatch: 20, isAbsorbedOil: true },
              { slug: "salt", rawGPerBatch: 6 },
            ],
          },
          {
            method: "deep_fried",
            label: "Crispy fried",
            isDefault: false,
            steps: ["Heat oil to 180 °C.", "Fry the fillets 4 minutes; drain on a rack."],
            ingredients: [
              { slug: "salmon_fillet", rawGPerBatch: 1250 },
              { slug: "olive_oil", rawGPerBatch: 400, isAbsorbedOil: true },
              { slug: "salt", rawGPerBatch: 6 },
            ],
          },
        ],
      },
      {
        name: "Potatoes",
        role: "carb",
        portioning: "continuous",
        minServingG: 0,
        maxServingG: 350,
        defaultServingG: 180,
        required: false,
        variants: [
          {
            method: "roasted",
            label: "Roasted",
            isDefault: true,
            steps: [
              "Cut into wedges, toss with 20 g oil per kg.",
              "Roast at 220 °C for 35 minutes.",
            ],
            ingredients: [
              { slug: "potato", rawGPerBatch: 1330 },
              { slug: "olive_oil", rawGPerBatch: 25 },
            ],
          },
          {
            method: "boiled",
            label: "Boiled",
            isDefault: false,
            steps: ["Boil in salted water for 18 minutes."],
            ingredients: [
              { slug: "potato", rawGPerBatch: 1050 },
              { slug: "salt", rawGPerBatch: 5 },
            ],
          },
        ],
      },
      {
        name: "Broccoli",
        role: "vegetable",
        portioning: "continuous",
        minServingG: 0,
        maxServingG: 250,
        defaultServingG: 100,
        required: false,
        variants: [
          {
            method: "steamed",
            label: "Steamed",
            isDefault: true,
            steps: ["Steam the florets for 5 minutes."],
            ingredients: [{ slug: "broccoli", rawGPerBatch: 1060 }],
          },
        ],
      },
    ],
  },
  {
    slug: "chickpea_salad",
    name: "Chickpea salad with tahini",
    description: "Chickpeas, tomato and cucumber with tahini-lemon dressing and khubz.",
    cuisine: "levantine",
    slotKeys: ["lunch", "packed_school_lunch", "packed_work_lunch"],
    flavourTags: ["fresh", "nutty"],
    isPackable: true,
    servedColdOk: true,
    components: [
      {
        name: "Chickpea salad",
        role: "protein",
        portioning: "continuous",
        minServingG: 100,
        maxServingG: 400,
        defaultServingG: 220,
        required: true,
        variants: [
          {
            method: "raw",
            label: "Tossed",
            isDefault: true,
            steps: [
              "Drain the chickpeas.",
              "Toss with diced vegetables, za'atar and the dressing.",
            ],
            ingredients: [
              { slug: "chickpeas_cooked", rawGPerBatch: 600 },
              { slug: "tomato", rawGPerBatch: 200 },
              { slug: "cucumber", rawGPerBatch: 150 },
              { slug: "tahini", rawGPerBatch: 30 },
              { slug: "lemon_juice", rawGPerBatch: 15 },
              { slug: "zaatar", rawGPerBatch: 5 },
            ],
          },
        ],
      },
      {
        name: "Khubz",
        role: "carb",
        portioning: "unit",
        unitLabel: "piece",
        minServingG: 0,
        maxServingG: 120,
        defaultServingG: 60,
        stepG: 30,
        required: false,
        variants: [
          {
            method: "baked",
            label: "Warm",
            isDefault: true,
            steps: ["Warm the bread for 2 minutes at 180 °C."],
            ingredients: [{ slug: "khubz", rawGPerBatch: 1000 }],
          },
        ],
      },
    ],
  },
  {
    slug: "beef_pasta",
    name: "Pasta with beef ragù",
    description: "Durum pasta with a lean beef and tomato ragù.",
    cuisine: "italian",
    slotKeys: ["dinner", "lunch"],
    flavourTags: ["rich"],
    isPackable: true,
    servedColdOk: false,
    components: [
      {
        name: "Pasta",
        role: "carb",
        portioning: "continuous",
        minServingG: 0,
        maxServingG: 350,
        defaultServingG: 180,
        required: false,
        variants: [
          {
            method: "boiled",
            label: "Al dente",
            isDefault: true,
            steps: ["Boil in salted water for 10 minutes."],
            ingredients: [
              { slug: "pasta_dry", rawGPerBatch: 400 },
              { slug: "salt", rawGPerBatch: 10 },
            ],
          },
        ],
      },
      {
        name: "Beef ragù",
        role: "protein",
        portioning: "continuous",
        minServingG: 80,
        maxServingG: 300,
        defaultServingG: 150,
        required: true,
        variants: [
          {
            method: "stewed",
            label: "Slow ragù",
            isDefault: true,
            steps: [
              "Brown the beef in 15 g oil.",
              "Add onion, garlic and tomato; simmer 45 minutes.",
            ],
            ingredients: [
              { slug: "beef_mince_lean", rawGPerBatch: 800 },
              { slug: "tomato", rawGPerBatch: 450 },
              { slug: "onion", rawGPerBatch: 120 },
              { slug: "garlic", rawGPerBatch: 10 },
              { slug: "olive_oil", rawGPerBatch: 15 },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "yogurt_side",
    name: "Greek yogurt (side)",
    description: "0% Greek yogurt, used as a protein adjuster (PLN-6).",
    cuisine: "greek",
    slotKeys: ["breakfast", "snack", "lunch", "dinner"],
    isPackable: true,
    servedColdOk: true,
    components: [
      {
        name: "Greek yogurt",
        role: "adjuster",
        portioning: "continuous",
        minServingG: 50,
        maxServingG: 250,
        defaultServingG: 100,
        required: true,
        variants: [
          {
            method: "raw",
            label: "Plain",
            isDefault: true,
            steps: ["Spoon into a bowl."],
            ingredients: [{ slug: "greek_yogurt_0", rawGPerBatch: 1000 }],
          },
        ],
      },
    ],
  },
];

/** mulberry32: a small deterministic PRNG, so F3's reviews are identical on every load. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REVIEW_TAGS = [
  "loved_it",
  "tasty",
  "bland",
  "too_salty",
  "too_oily",
  "dry",
  "too_much",
  "too_little",
  "just_right",
  "more_often",
  "less_often",
];
const REVIEW_TARGETS: { targetType: FixtureReviewInput["targetType"]; target: string }[] = [
  ...dishes.map((d) => ({ targetType: "dish" as const, target: d.slug })),
  { targetType: "variant", target: "salmon_potatoes#0#0" },
  { targetType: "variant", target: "salmon_potatoes#0#2" },
  { targetType: "variant", target: "chicken_rice_plate#0#1" },
  { targetType: "component", target: "chicken_rice_plate#2" },
  { targetType: "ingredient", target: "chickpeas_cooked" },
  { targetType: "cuisine", target: "italian" },
  { targetType: "method", target: "deep_fried" },
];
const AUTHORS: { user: string; members: string[] }[] = [
  { user: "t1", members: ["t1", "k1", "k2", "k3"] },
  { user: "t2", members: ["t2"] },
  { user: "t3", members: ["t3"] },
  { user: "k1", members: ["k1"] },
];

function syntheticReviews(days: number, perDay: number, seed: number): FixtureReviewInput[] {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error("empty list");
    return item;
  };
  const reviews: FixtureReviewInput[] = [];
  const start = Date.UTC(2026, 7, 1, 19, 0, 0); // 2026-08-01 19:00Z
  for (let day = 0; day < days; day += 1) {
    for (let n = 0; n < perDay; n += 1) {
      const author = pick(AUTHORS);
      const target = pick(REVIEW_TARGETS);
      const rating = 1 + Math.floor(random() * 5);
      const tags = random() < 0.6 ? [pick(REVIEW_TAGS)] : [];
      reviews.push({
        authorUser: author.user,
        onBehalfOf: pick(author.members),
        ...target,
        rating,
        tags,
        ...(random() < 0.3 ? { comment: `Synthetic review ${String(day)}-${String(n)}` } : {}),
        createdAt: new Date(start + day * 86_400_000 + n * 60_000).toISOString(),
        reactions:
          random() < 0.25 ? [{ user: author.user === "t1" ? "t2" : "t1", kind: "agree" }] : [],
      });
    }
  }
  return reviews;
}

export const F3_REVIEW_DAYS = 30;
export const F3_REVIEWS_PER_DAY = 2;

export const F3: FixtureInput = {
  id: "F3",
  household: { name: "Household F3", regionNote: "Dubai Marina" },
  users: [
    { key: "t1", email: "t1@f3.example", name: "Targeted 1", role: "admin", member: "t1" },
    { key: "t2", email: "t2@f3.example", name: "Targeted 2", role: "admin", member: "t2" },
    { key: "t3", email: "t3@f3.example", name: "Targeted 3", role: "member", member: "t3" },
    { key: "k1", email: "k1@f3.example", name: "Kid 1", role: "member", member: "k1" },
    { key: "kitchen", email: "kitchen@f3.example", name: "Kitchen F3", role: "kitchen" },
  ],
  members: [
    {
      key: "t1",
      displayName: "Targeted 1",
      color: "sea",
      birthYear: 1980,
      appetite: "large",
      targets: { default: target(2400, 190, 240, 75), training: target(2700, 190, 310, 75) },
      training: [
        { weekday: 0, sessionTime: "06:30:00", intensity: "hard" },
        { weekday: 3, sessionTime: "06:30:00", intensity: "moderate" },
      ],
    },
    {
      key: "t2",
      displayName: "Targeted 2",
      color: "saffron",
      birthYear: 1983,
      appetite: "medium",
      targets: { default: target(1700, 125, 170, 55) },
      tolerance: { proteinG: 8, carbsG: 8, fatG: 4, kcal: 80, mode: "flexible" },
    },
    {
      key: "t3",
      displayName: "Targeted 3",
      color: "basil",
      birthYear: 1995,
      appetite: "large",
      targets: { default: target(2900, 200, 330, 85) },
      training: [
        { weekday: 1, sessionTime: "19:00:00" },
        { weekday: 4, sessionTime: "19:00:00" },
      ],
    },
    {
      key: "t4",
      displayName: "Targeted 4",
      color: "aubergine",
      birthYear: 1958,
      appetite: "small",
      targets: { default: target(1500, 100, 150, 50) },
    },
    {
      key: "t5",
      displayName: "Targeted 5",
      color: "olive",
      birthYear: 2007,
      appetite: "large",
      targets: { default: target(2600, 160, 320, 75) },
    },
    { key: "k1", displayName: "Kid 1", color: "tomato", birthYear: 2013, appetite: "medium" },
    { key: "k2", displayName: "Kid 2", color: "pomegranate", birthYear: 2017, appetite: "small" },
    { key: "k3", displayName: "Kid 3", color: "flour", birthYear: 2020, appetite: "small" },
  ],
  slots: {
    active: [
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "packed_school_lunch",
      "packed_work_lunch",
      "pre_workout",
      "post_workout",
    ],
    custom: [
      {
        key: "mid_morning",
        label: "Mid-morning",
        emoji: "☕",
        sortOrder: 15,
        defaultTime: "10:30:00",
        isShared: false,
        isPacked: false,
        reheatAvailable: false,
      },
      {
        key: "family_brunch",
        label: "Family brunch",
        emoji: "🥞",
        sortOrder: 12,
        defaultTime: "11:00:00",
        isShared: true,
        isPacked: false,
        reheatAvailable: false,
        constraintsNote: "weekends only",
      },
    ],
  },
  schedules: [
    ...["k1", "k2"].flatMap((member) => [
      { member, slot: "packed_school_lunch", weekdays: [0, 1, 2, 3, 4], attends: true },
      { member, slot: "packed_school_lunch", weekdays: [5, 6], attends: false },
      { member, slot: "lunch", weekdays: [0, 1, 2, 3, 4], attends: false },
    ]),
    ...["t1", "t2", "t3", "t4", "t5", "k3"].map((member) => ({
      member,
      slot: "packed_school_lunch",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      attends: false,
    })),
    ...["t1", "t3"].flatMap((member) => [
      { member, slot: "packed_work_lunch", weekdays: [0, 1, 2, 3, 4], attends: true },
      { member, slot: "lunch", weekdays: [0, 1, 2, 3, 4], attends: false },
    ]),
    ...["t1", "t2", "t3", "t4", "t5", "k1", "k2", "k3"].flatMap((member) => [
      ...(member === "t1" || member === "t3"
        ? []
        : [{ member, slot: "packed_work_lunch", weekdays: [0, 1, 2, 3, 4], attends: false }]),
      { member, slot: "packed_work_lunch", weekdays: [5, 6], attends: false },
      { member, slot: "family_brunch", weekdays: [0, 1, 2, 3, 4], attends: false },
    ]),
    { member: "t4", slot: "mid_morning", weekdays: [0, 1, 2, 3, 4, 5, 6], attends: true },
    { member: "k3", slot: "snack", weekdays: [5, 6], attends: false },
  ],
  cuisines: { liked: ["levantine", "italian", "indian", "japanese"], disliked: ["mexican"] },
  exclusions: [
    { member: "k2", kind: "dietary_flag", key: "contains_nuts", reason: "allergy" },
    { member: "t4", kind: "ingredient", key: "feta", reason: "medical" },
    { kind: "dietary_flag", key: "contains_pork", reason: "religious" },
    { kind: "dietary_flag", key: "contains_alcohol", reason: "religious" },
    { member: "t5", kind: "category", key: "seafood", reason: "dislike" },
  ],
  presets: [
    {
      name: "Weekend",
      values: { macroPrecision: 0.8, appeal: 0.9, ingredientEconomy: 0.2 },
      appliesToWeekdays: [5, 6],
    },
    {
      name: "Busy week",
      values: { macroPrecision: 1, appeal: 0.5, ingredientEconomy: 0.7 },
      appliesToWeekdays: [0, 1, 2, 3],
    },
  ],
  dishes,
  reviews: syntheticReviews(F3_REVIEW_DAYS, F3_REVIEWS_PER_DAY, 20260801),
};
