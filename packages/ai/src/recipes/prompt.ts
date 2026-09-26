// REC-2 §2 system prompt, §3 user message, and the REC-5 follow-up (append-only).
// The two system blocks are rendered from sorted catalogue data only, so they are byte-stable
// across calls and households and carry the prompt-cache breakpoints. Everything volatile
// (household context, date-dependent targets, the admin's request) is in the user message.
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { StructuredRequest } from "../client/index.js";
import type { RecipeCatalogue } from "./catalogue.js";
import type { GenerationContext } from "./context.js";
import { DishBatchSchema } from "./schema.js";

/** REC-2: recipe generation runs at effort `high`. */
export const RECIPE_EFFORT = "high";

/** §2 items 1–2: role and output rules. Constant text. */
export const SYSTEM_PROMPT = `You are an expert home-cooking recipe developer. You write recipes for professional household kitchen staff in the United Arab Emirates, who cook for one family and portion each plate separately for each person.

You receive the family's meal context and return new dishes as structured output. A deterministic nutrition engine and a portion solver check every dish you write: they compute the nutrition from your ingredient weights and choose each person's grams. You are responsible for the cooking: cuisine, flavour, components, preparation variants, ingredient ratios and steps.

Output rules:
- Use only ingredient slugs from the catalogue below. If an essential ingredient is missing, add it to newIngredients with nutrition per 100 g raw (kcal, protein, available carbohydrate, fat, saturated fat, fibre, soluble fibre or null when unknown) and a source note naming the reference. New ingredients are verified later. When the context lists any dietary-flag exclusion (an allergy), use catalogue ingredients only: a new ingredient cannot be checked against the allergy, so a dish that uses one is rejected.
- All quantities are raw edible grams per reference batch of 1000 g cooked, for each variant. Give fats and oils by weight. Mark cooking fat that is only partly absorbed (frying oil, oil for searing) with isAbsorbedFat = true; fat that stays in the dish (oil in a dressing, butter in a sauce) is isAbsorbedFat = false. Spices under 5 g may be "to taste", with an approximate weight. Do not list water or stock that a grain, pasta or pulse absorbs while cooking: its cooked weight already includes it. List only liquid that stays in the dish, such as the stock of a soup or stew.
- Each component that could plausibly be prepared more than one way gets 2 to 3 preparation variants that share the same core ingredients and differ in method, coating or cooking fat. Example: fish as grilled, pan-seared or breaded and fried; potato as boiled, roasted or air-fried chips. Every variant must be something the family would recognise as the same dish. Mark exactly one variant of each component isDefault = true.
- Components are portioned separately: protein, carbohydrate, vegetable, sauce and so on. Sauces and dressings are their own component, so the solver can control fat.
- Every dish gives the solver macro room: at least one lean protein component, one carbohydrate component and one controllable fat source (a sauce or dressing component), so that people with different macro targets can all be served from the same dish.
- minServingG, maxServingG and defaultServingG are realistic cooked grams per plate, with minServingG <= defaultServingG <= maxServingG.
- Steps are numbered, imperative and specific: temperature in degrees Celsius, minutes, pan type and doneness cues. No step says "season to taste" without a gram hint. Use metric units only.
- Respect whether the slot is packed, whether reheating is available, and slot suitability: set isPackable and servedColdOk truthfully, and list in slotKeys only slot keys named in the request.
- Never use an excluded ingredient, ingredient category or dietary flag, including inside sauces, marinades and garnishes. Exclusions are hard.
- Do not repeat or closely imitate a dish listed to avoid.
- Write plain text. No emoji.
- method is a preparation-method key and cuisine a cuisine key from the lists below.`;

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** §2 items 3–4: the catalogue (sorted by slug), then the method and cuisine keys. */
export function catalogueBlock(catalogue: RecipeCatalogue): string {
  const lines = [...catalogue.ingredients]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((i) => {
      const n = i.per100gRaw;
      return `${i.slug} | ${i.name} | ${i.category} | ${num(n.kcal)} ${num(n.protein)} ${num(n.carbs)} ${num(n.fat)}`;
    });
  const methods = [...catalogue.methods].sort();
  const cuisines = [...catalogue.cuisines].sort();
  return [
    "Ingredient catalogue. One line per ingredient: slug | name | category | kcal protein carbs fat per 100 g raw (carbs are available carbohydrate).",
    ...lines,
    "",
    `Preparation-method keys: ${methods.join(", ")}`,
    `Cuisine keys: ${cuisines.join(", ")}`,
  ].join("\n");
}

/** The two cached system blocks (REC-2 prompt caching). */
export function systemBlocks(catalogue: RecipeCatalogue): BetaTextBlockParam[] {
  return [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogueBlock(catalogue), cache_control: { type: "ephemeral" } },
  ];
}

/** The first user message: the volatile context after the cached prefix (REC-3). */
export function contextMessage(context: GenerationContext, slotKeys: readonly string[]): string {
  return [
    `Write ${String(context.count)} new ${context.count === 1 ? "dish" : "dishes"} for the "${context.slot.key}" slot.`,
    `Slot keys this household uses: ${[...slotKeys].sort().join(", ")}.`,
    "Plate targets are per person for this meal; carbs in a plate target are total carbohydrate (available carbohydrate plus fibre).",
    "People are identified by labels only.",
    "Context (JSON):",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

/** The request for the first call. */
export function buildRecipeRequest(
  catalogue: RecipeCatalogue,
  context: GenerationContext,
  slotKeys: readonly string[],
): StructuredRequest<typeof DishBatchSchema> {
  return {
    schema: DishBatchSchema,
    system: systemBlocks(catalogue),
    messages: [{ role: "user", content: contextMessage(context, slotKeys) }],
    effort: RECIPE_EFFORT,
  };
}

/**
 * The assistant content to append, unchanged, for a follow-up. After a mid-output fallback the
 * blocks before the final `fallback` marker that the next model cannot continue (thinking,
 * redacted thinking, tool use) are omitted, as the fallback contract requires.
 */
export function echoableContent(content: readonly BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  const dropped = new Set(["thinking", "redacted_thinking", "tool_use", "server_tool_use"]);
  return content.filter((block, i) => !(i < boundary && dropped.has(block.type)));
}

export type RejectionNote = { dishName: string; reasons: string[] };

/** The follow-up user message (REC-5): each rejection reason, and how many dishes to replace. */
export function followUpMessage(rejections: readonly RejectionNote[], needed: number): string {
  return [
    `Some dishes did not pass validation. Write ${String(needed)} replacement ${needed === 1 ? "dish" : "dishes"} that avoid these problems, following the same rules and context. Return only the replacement dishes (and any new ingredients they use).`,
    ...rejections.map((r) => `- ${r.dishName}: ${r.reasons.join("; ")}`),
  ].join("\n");
}

/** The follow-up request: the first request's messages, the model's response, then the reasons. */
export function buildFollowUpRequest(
  first: StructuredRequest<typeof DishBatchSchema>,
  assistantContent: readonly BetaContentBlock[],
  rejections: readonly RejectionNote[],
  needed: number,
): StructuredRequest<typeof DishBatchSchema> {
  const messages: BetaMessageParam[] = [
    ...first.messages,
    { role: "assistant", content: echoableContent(assistantContent) },
    { role: "user", content: followUpMessage(rejections, needed) },
  ];
  return { ...first, messages };
}
