// FBK-7 stage 2 structured output (leaf-1.3.3 ADR-2). Structured outputs need every object closed
// (`additionalProperties: false`), and op payloads differ per kind, so each op carries its payload
// as a JSON string. `kind` is a plain string, not an enum: a wrong kind must reach local validation
// (dropped and logged, G3) instead of failing the whole parse.
import { z } from "zod";

export const WireOpSchema = z
  .object({
    kind: z.string().describe("A change-op kind from the allowed list."),
    payloadJson: z
      .string()
      .describe("The op payload as a JSON object, matching that kind's payload schema."),
  })
  .strict();

export const WireProposalSchema = z
  .object({
    title: z.string().describe("Short imperative title, under 80 characters."),
    rationale: z.string().describe("Why, in one to three sentences, citing the evidence."),
    priority: z.number().int().describe("1 (low) to 5 (high)."),
    evidenceReviewIds: z
      .array(z.string())
      .describe("Ids of the reviews this proposal rests on; only ids from the input."),
    ops: z.array(WireOpSchema).describe("The change ops that implement the proposal."),
  })
  .strict();

export const SynthesisOutputSchema = z
  .object({
    proposals: z
      .array(WireProposalSchema)
      .describe("De-duplicated proposals, highest priority first."),
  })
  .strict();

export type WireProposal = z.output<typeof WireProposalSchema>;
export type SynthesisOutput = z.output<typeof SynthesisOutputSchema>;
