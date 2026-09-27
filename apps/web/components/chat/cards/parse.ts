// AGT-7 card payloads, validated before they are drawn (leaf-1.4.5 ADR-2). The shapes are those of
// `packages/ai/src/agent/cards.ts` and the tools that fill them (1.3.5); `macro_table` rows follow
// SPEC-Q-4. A card that does not parse is shown as "can't be shown", never as a crash.
import { z } from "zod";
import { DescriptionDto, JsonValue, PlanMealDto } from "@mealplanner/api-contract/contract";
import { FIT_STATUSES } from "@mealplanner/core/types";

const Macro = z.object({
  kcal: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
});

export const ProposalCardSchema = z.object({
  type: z.literal("proposal"),
  proposalId: z.string(),
  title: z.string(),
  rationale: z.string(),
  descriptions: z.array(DescriptionDto),
  evidence: JsonValue,
  status: z.string(),
});

export const AppliedChangeCardSchema = z.object({
  type: z.literal("applied_change"),
  changeSetId: z.string(),
  summary: z.string(),
  descriptions: z.array(DescriptionDto),
  appliedAt: z.string(),
});

export const PlanDayCardSchema = z.object({
  type: z.literal("plan_day"),
  date: z.string(),
  meals: z.array(PlanMealDto),
});

const Reason = z.object({ message: z.string() }).loose();

export const DraftDishSchema = z.object({
  /** R-53: the exact ops Save posts (ingredient.create …, dish.create). */
  ops: z.array(z.object({ kind: z.string(), payload: z.record(z.string(), JsonValue) })).min(1),
  summary: z.string(),
  dish: z
    .object({
      name: z.string(),
      description: z.string(),
      cuisine: z.string(),
      secondaryCuisine: z.string().optional(),
      slotKeys: z.array(z.string()),
      components: z.array(
        z
          .object({
            name: z.string(),
            role: z.string(),
            variants: z.array(
              z.object({ method: z.string(), label: z.string(), cookTimeMin: z.number() }).loose(),
            ),
          })
          .loose(),
      ),
    })
    .loose(),
  newIngredients: z.array(z.object({ slug: z.string(), name: z.string() }).loose()),
  candidate: z.boolean(),
  reasons: z.array(Reason).default([]),
  plates: z.array(
    z.object({
      label: z.string(),
      member: z.string(),
      status: z.string(),
      explain: z.array(z.string()),
    }),
  ),
});

export const RecipeCardSchema = z.object({
  type: z.literal("recipe"),
  jobId: z.string(),
  dishes: z.array(DraftDishSchema),
  rejected: z.array(z.object({ dishName: z.string(), reasons: z.array(Reason) })).default([]),
  /** leaf 1.4.9 (R-61): the day and slot the request named, for "Use for <Day> <slot>". */
  use: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      slotKey: z.string().min(1),
      slotLabel: z.string().min(1),
    })
    .optional(),
});

export const MacroRowSchema = z.object({
  member: z.string(),
  slot: z.string(),
  target: Macro.nullable(),
  actual: Macro.nullable(),
  fitStatus: z.enum(FIT_STATUSES).optional(),
});

export const MacroTableCardSchema = z.object({
  type: z.literal("macro_table"),
  date: z.string(),
  /** Rows that do not match SPEC-Q-4's shape are shown as "—" (null), not dropped. */
  rows: z.array(JsonValue),
});

export const JobProgressCardSchema = z.object({
  type: z.literal("job_progress"),
  jobId: z.string(),
  kind: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  error: z.string().optional(),
  /** leaf 1.4.9 (W-9b): a plan no agent turn started, announced in Updates. */
  ready: z
    .object({
      title: z.string(),
      facts: z.array(z.string()),
      href: z.string(),
      action: z.string(),
    })
    .optional(),
});

export const InsightDigestCardSchema = z.object({
  type: z.literal("insight_digest"),
  runAt: z.string(),
  proposals: z.array(
    z.object({ id: z.string(), kind: z.string(), title: z.string(), rationale: z.string() }),
  ),
  dropped: z.array(z.object({ title: z.string(), reason: z.string() })),
  notes: z.array(z.object({ title: z.string(), rationale: z.string() }).loose()),
  /** leaf 1.4.9 (W-9a): changes made automatically since the previous digest; older digests lack it. */
  automatic: z
    .array(
      z.object({
        changeSetId: z.string(),
        title: z.string(),
        detail: z.string(),
        appliedAt: z.string(),
        undone: z.boolean(),
      }),
    )
    .default([]),
});

export const IterationLimitCardSchema = z.object({
  type: z.literal("iteration_limit"),
  limit: z.number(),
  ran: z.array(z.object({ name: z.string(), ok: z.boolean() })),
  notRun: z.array(z.object({ name: z.string() })),
});

export const CardSchema = z.discriminatedUnion("type", [
  ProposalCardSchema,
  AppliedChangeCardSchema,
  PlanDayCardSchema,
  RecipeCardSchema,
  MacroTableCardSchema,
  JobProgressCardSchema,
  InsightDigestCardSchema,
  IterationLimitCardSchema,
]);

export type Card = z.output<typeof CardSchema>;
export type ProposalCard = z.output<typeof ProposalCardSchema>;
export type AppliedChangeCard = z.output<typeof AppliedChangeCardSchema>;
export type PlanDayCard = z.output<typeof PlanDayCardSchema>;
export type RecipeCard = z.output<typeof RecipeCardSchema>;
export type DraftDish = z.output<typeof DraftDishSchema>;
export type MacroTableCard = z.output<typeof MacroTableCardSchema>;
export type MacroRow = z.output<typeof MacroRowSchema>;
export type JobProgressCard = z.output<typeof JobProgressCardSchema>;
export type InsightDigestCard = z.output<typeof InsightDigestCardSchema>;
export type IterationLimitCard = z.output<typeof IterationLimitCardSchema>;

export type ParsedCard = { ok: true; card: Card } | { ok: false; type: string };

export function parseCard(value: unknown): ParsedCard {
  const parsed = CardSchema.safeParse(value);
  if (parsed.success) return { ok: true, card: parsed.data };
  const type =
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
      ? (value as { type: string }).type
      : "unknown";
  return { ok: false, type };
}

/** A `macro_table` row, or null when it does not have SPEC-Q-4's shape. */
export function macroRow(value: unknown): MacroRow | null {
  const parsed = MacroRowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
