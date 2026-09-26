// FBK-7 stage 2 request: a stable, cached system prompt (role, rules, the allowed op kinds with
// their payload schemas) and one user message with the run's pseudonymised context.
import type {
  BetaMessageParam,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { getOp } from "@mealplanner/core/changes";
import { NEVER_PROPOSED_KINDS } from "@mealplanner/core/learning/rules";
import type { Effort, StructuredRequest } from "../client/index.js";
import type { SynthesisContext } from "./context.js";
import { SynthesisOutputSchema } from "./schema.js";

/** Insight synthesis effort (leaf-1.3.3 ADR-2). */
export const INSIGHTS_EFFORT: Effort = "high";

/**
 * The op kinds synthesis may propose (FBK-7 "the allowed set"; ADR-2): the preference, exclusion,
 * frequency, meal-split, weights and ingredient-verification ops the input gives the model enough
 * to fill in. None is statically protected and none is an R-10 kind; the conditional protections
 * (a relaxing exclusion.add) are checked again by the service's guardrails.
 */
export const INSIGHT_KINDS: readonly string[] = [
  "preference.set",
  "preference.reset",
  "exclusion.add",
  "frequency.set",
  "distribution.set",
  "weights.set",
  "ingredient.verify",
].filter((kind) => !NEVER_PROPOSED_KINDS.includes(kind) && getOp(kind)?.protected !== true);

export const SYSTEM_PROMPT = `You are the insights engine of a family meal planner. The family's reviews of meals, a set of deterministic rules and the admin's past decisions are your input. You turn them into a short, de-duplicated, prioritised list of proposals. The admin reads each proposal and accepts or rejects it; nothing you propose is applied without that.

How to work:
- Start from the rule candidates. Keep the ones the evidence supports, merge duplicates, and rewrite titles and rationales so a busy parent understands them in one read. You may drop a rule candidate that the reviews contradict.
- You may add proposals the rules missed, from the review comments, for example "bored of rice at lunch" or "the kids never eat the salad". Every added proposal must rest on specific reviews: cite their ids in evidenceReviewIds.
- Do not repeat anything the admin rejected recently unless the new evidence is clearly stronger; read the rejection notes.
- Prefer fewer, stronger proposals. At most 5.
- People are named by labels only (Adult A, Child B). Use the labels in titles, rationales and in memberId fields; never invent names.
- Use only ids that appear in the input (dishes, ingredients, slots, reviews). Never invent an id.

Output rules:
- Each proposal has a title, a rationale, a priority from 1 (low) to 5 (high), evidenceReviewIds, and one or more ops.
- Each op has a kind from the allowed list below and payloadJson: the op's payload as a JSON object matching that kind's schema. In memberId fields write the member's label (for example "Adult A"), or null for the whole household; this replaces the uuid the schema describes for memberId.
- Preference scores run from -1 (strong dislike) to 1 (strong like). A preference key for one preparation of a dish is "<dishId>#<variantId>".
- Never propose removing or relaxing an allergy or another hard exclusion, loosening tolerances, or changing access, roles or support access. Those need the admin to ask in person.
- Plain text, no emoji.`;

/** The allowed kinds with their payload JSON schemas, sorted: byte-stable, so it caches. */
export function kindsBlock(): string {
  const lines = [...INSIGHT_KINDS].sort().map((kind) => {
    const def = getOp(kind);
    if (def === undefined) throw new Error(`unknown insight kind ${kind}`);
    const schema = z.toJSONSchema(def.schema, { io: "input", unrepresentable: "any" });
    return `${kind}: ${JSON.stringify(schema)}`;
  });
  return ["Allowed op kinds and their payload JSON schemas:", ...lines].join("\n");
}

export function systemBlocks(): BetaTextBlockParam[] {
  return [
    { type: "text", text: SYSTEM_PROMPT },
    { type: "text", text: kindsBlock(), cache_control: { type: "ephemeral" } },
  ];
}

export function contextMessage(context: SynthesisContext): string {
  return [
    "Here is this run's input. Return the proposals as structured output.",
    "Context (JSON):",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

export function buildSynthesisRequest(
  context: SynthesisContext,
): StructuredRequest<typeof SynthesisOutputSchema> {
  const messages: BetaMessageParam[] = [{ role: "user", content: contextMessage(context) }];
  return {
    schema: SynthesisOutputSchema,
    system: systemBlocks(),
    messages,
    effort: INSIGHTS_EFFORT,
  };
}
