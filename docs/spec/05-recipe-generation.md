# 05 — AI recipe generation

Claude writes the recipes and the deterministic engine checks them. The model is responsible for the culinary content: cuisine, flavour, components, preparation variants, ingredient ratios and steps. The numbers that decide macro fit are computed by the nutrition engine and the solver (REC-1).

## 1. Model and API usage (REC-2)

- SDK: `@anthropic-ai/sdk` (TypeScript). The model comes from env `ANTHROPIC_MODEL`, default `claude-opus-5`.
- Structured output: `client.messages.parse()` with `output_config.format = zodOutputFormat(DishBatchSchema)`, where `DishBatchSchema` is the Zod schema below.
- Thinking: `{ type: "adaptive" }`, `output_config.effort = "high"`.
- Refusal fallback: send beta `server-side-fallback-2026-07-01` with `fallbacks: "default"`. Always check `stop_reason` before reading content, and handle `refusal` and `max_tokens`.
- Prompt caching: the system prompt and the ingredient catalogue block are byte-stable and carry `cache_control: { type: "ephemeral" }`. Everything volatile (date, household context) goes in the user message after the cached prefix.
- Errors: use the SDK's typed errors (`RateLimitError`, `APIError`, …). Retry 429 and 5xx with backoff (the SDK default of 2 retries).
- Every call writes an `ai_generation` row (DM-7).
- With no credentials configured, generation is disabled. The planner falls back to the library and the UI says so. There is no silent failure.

## 2. System prompt (stable, cached)

Contents, in this order:
1. Role: an expert home-cooking recipe developer writing for professional household kitchen staff.
2. Output rules:
   - Use only ingredient slugs from the catalogue. If an essential ingredient is missing, add it to `newIngredients` with nutrition per 100 g raw and a source note. Such ingredients are verified later.
   - All quantities are raw grams per reference batch of 1000 g cooked per variant. Fats and oils are always given by weight. Spices under 5 g may be "to taste" with an approximate weight.
   - Each component that could plausibly be prepared more than one way gets 2–3 **preparation variants that share the same core ingredients** and differ in method, coating or cooking fat. Example: fish → grilled / pan-seared / breaded-fried; potato → boiled / roasted / air-fried chips. Every variant must be something the family would recognise as the same dish.
   - Components are portionable separately: protein, carb, vegetable, sauce, and so on. Sauces and dressings are their own component so the solver can control fat.
   - `min_serving_g` / `max_serving_g` / `default_serving_g` are realistic cooked grams per plate.
   - Steps are numbered, imperative and specific: °C, minutes, pan type, doneness cues. No step says "season to taste" without a gram hint.
   - Respect `is_packable`, `served_cold_ok` and slot suitability.
3. The ingredient catalogue: slug, name, category, and kcal/P/C/F per 100 g, as compact lines. The catalogue is sorted by slug so the cached prefix stays stable.
4. The preparation-method keys and the cuisine keys.

## 3. Generation context (user message) (REC-3)

```ts
type GenerationContext = {
  slot: { key: string; label: string; isPacked: boolean; reheat: boolean; constraintsNote?: string };
  count: number;                          // dishes requested, default 3
  cuisines: { prefer: string[]; avoidRecent: string[] };   // from household + attendee appeal and variety
  palette: { slug: string; timesUsed: number }[];          // ingredients already in the window: "prefer these"
  attendees: Array<{ label: string /* pseudonymous, e.g. "Adult A" */; targeted: boolean;
    plateTarget?: { kcal: number; protein: number; carbs: number; fat: number };
    likes: string[]; dislikes: string[] }>;
  exclusions: { ingredients: string[]; categories: string[]; dietaryFlags: string[] }; // union over attendees, hard
  avoidDishes: string[];                  // names of existing similar/recent dishes
  adminRequest?: string;                  // free text when the admin asked in chat, e.g. "a British breakfast using labneh"
  locale: { country: 'AE'; regionNote?: string };
};
```

Members are pseudonymised: names and ages are not sent. Targets are sent as numbers. The prompt asks for dishes whose **components give the solver macro room**: at least one lean protein component, one carbohydrate component and one controllable fat source (sauce or dressing), so that differently targeted attendees can all be fitted.

## 4. Output schema (REC-4)

```ts
const VariantSchema = z.object({
  method: z.string(),                    // preparation_method.key
  label: z.string(),
  isDefault: z.boolean(),
  ingredients: z.array(z.object({ slug: z.string(), rawGramsPerBatch: z.number().positive(),
    isAbsorbedFat: z.boolean(), note: z.string().optional() })).min(1),
  steps: z.array(z.string()).min(1),
  cookTimeMin: z.number().int().positive(),
});
const ComponentSchema = z.object({
  name: z.string(), role: z.enum(['protein','carb','vegetable','sauce','fat','garnish','side','drink']),
  portioning: z.enum(['continuous','unit','fixed']), unitLabel: z.string().optional(),
  minServingG: z.number(), maxServingG: z.number(), defaultServingG: z.number(), required: z.boolean(),
  variants: z.array(VariantSchema).min(1).max(3),
});
const DishSchema = z.object({
  name: z.string(), description: z.string(), cuisine: z.string(), secondaryCuisine: z.string().optional(),
  slotKeys: z.array(z.string()).min(1), flavourTags: z.array(z.string()),
  isPackable: z.boolean(), servedColdOk: z.boolean(),
  components: z.array(ComponentSchema).min(1).max(6),
  assemblySteps: z.array(z.string()),
});
const DishBatchSchema = z.object({
  dishes: z.array(DishSchema),
  newIngredients: z.array(z.object({ slug: z.string(), name: z.string(), category: z.string(),
    per100g: z.object({ kcal: z.number(), protein: z.number(), carbs: z.number(), fat: z.number(),
      satFat: z.number(), fibre: z.number(), solubleFibre: z.number().nullable() }),
    sourceNote: z.string() })),
});
```

## 5. Validation pipeline (REC-5)

Each returned dish goes through these steps, in order:

1. **Schema.** Parsed by the SDK. If `parsed_output` is null, the whole call fails.
2. **References.** Every slug resolves to the catalogue or to `newIngredients`. Every method and cuisine key exists. `min ≤ default ≤ max`.
3. **Exclusions.** No excluded ingredient, category or dietary flag appears in any variant. A violation rejects the dish; the model is never trusted on allergies.
4. **Variant discipline.** Variants of a component share ≥ 70 % of their non-fat, non-coating ingredients by weight. Otherwise the variant is split out as its own component or the dish is rejected.
5. **Nutrition.** Compute per-variant nutrition. The Atwater check (NUT-4) must pass. New ingredients must pass their own Atwater check.
6. **Duplication.** Reject if the name is ≥ 0.85 trigram-similar to, or the core-ingredient Jaccard is ≥ 0.8 with, an existing active dish in the household or seed library.
7. **Solver feasibility.** Solve plates for the context's targeted attendees. A dish that is infeasible for any targeted attendee is kept in the library (`active`) but not returned as a candidate for this slot.

If fewer than `count` dishes survive, the generator makes **one** follow-up call. It appends the model's previous response and a user message listing each rejection reason. The conversation is only ever appended to, never edited. Survivors are saved via a change set (`source: ai`).

## 6. Admin-initiated generation (REC-6)

The agent tool `create_recipe` ([07-agent.md](07-agent.md)) uses the same generator with `adminRequest` set and `count` from the request (default 1). In chat, the result appears as a recipe card with per-attendee example plates, plus Save or Discard.

## 7. Recipe editing (REC-7)

Admins can edit any household dish: rename, adjust ingredient grams, add or remove variants, change serving bounds. Each edit bumps `dish.version`, recomputes nutrition, and re-solves future plates that use the dish. Seed-library dishes are copy-on-write: editing one creates a household copy.
