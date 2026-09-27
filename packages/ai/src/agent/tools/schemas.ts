// The AGT-4 tools: one Zod input schema each. The JSON Schema sent as `input_schema` is generated
// from the same schema (ADR-1), and every definition streams its input eagerly (AGT-2). The model
// never passes a household id: every tool is scoped by the server session.
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { PROPOSAL_STATUSES, REVIEW_TARGET_TYPES } from "@mealplanner/core/types";
import { withoutDialect } from "../prompt.js";

const uuid = z.uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "a real calendar date");

/** Longest date range a plan read or plan generation covers in one call. */
export const MAX_PLAN_RANGE_DAYS = 14;

function dayCount(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

const DateRange = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((r) => dayCount(r.from, r.to) >= 1, "`to` is on or after `from`")
  .refine(
    (r) => dayCount(r.from, r.to) <= MAX_PLAN_RANGE_DAYS,
    `at most ${String(MAX_PLAN_RANGE_DAYS)} days`,
  );

/** One change op as the model sends it; the payload is validated by the registry (AGT-6). */
export const WireChangeOp = z
  .object({
    kind: z.string().min(1).max(60),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const Ops = z.array(WireChangeOp).min(1).max(50);

export const TOOL_SCHEMAS = {
  // Read
  get_household: z.object({}).strict(),
  get_plan: DateRange,
  explain_meal: z.object({ planMealId: uuid }).strict(),
  search_dishes: z
    .object({
      query: z.string().trim().min(1).max(120).optional(),
      cuisine: z.string().trim().min(1).max(60).optional(),
      slot: z.string().trim().min(1).max(60).optional(),
      ingredient: z.string().trim().min(1).max(80).optional(),
      limit: z.number().int().min(1).max(50).default(10),
    })
    .strict(),
  get_dish: z.object({ dishId: uuid }).strict(),
  get_reviews: z
    .object({
      target: z
        .object({ type: z.enum(REVIEW_TARGET_TYPES), id: z.string().min(1).max(200) })
        .strict()
        .optional(),
      memberId: uuid.optional(),
      since: isoDate.optional(),
      minRating: z.number().int().min(1).max(5).optional(),
      maxRating: z.number().int().min(1).max(5).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  get_preferences: z.object({ memberId: uuid.optional() }).strict(),
  get_proposals: z.object({ status: z.enum(PROPOSAL_STATUSES).optional() }).strict(),
  get_change_log: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
  // Actions
  generate_plan: z
    .object({ from: isoDate, to: isoDate, keepLocked: z.literal(true).default(true) })
    .strict()
    .refine((r) => dayCount(r.from, r.to) >= 1, "`to` is on or after `from`")
    .refine(
      (r) => dayCount(r.from, r.to) <= MAX_PLAN_RANGE_DAYS,
      `at most ${String(MAX_PLAN_RANGE_DAYS)} days`,
    ),
  suggest_alternatives: z
    .object({ planMealId: uuid, instruction: z.string().trim().min(1).max(500).optional() })
    .strict(),
  create_recipe: z
    .object({
      request: z.string().trim().min(1).max(1000),
      slot: z.string().trim().min(1).max(60).optional(),
      // 1.4.9 (R-61, R-66): the day the recipe is for, when the admin names one.
      date: isoDate.optional(),
      count: z.number().int().min(1).max(5).default(1),
    })
    .strict(),
  run_insights: z.object({}).strict(),
  // Changes
  apply_change: z.object({ summary: z.string().trim().min(1).max(200), ops: Ops }).strict(),
  propose_change: z
    .object({
      title: z.string().trim().min(1).max(200),
      rationale: z.string().trim().min(1).max(2000),
      evidence: z
        .object({
          reviewIds: z.array(uuid).max(50).optional(),
          note: z.string().max(500).optional(),
        })
        .strict()
        .optional(),
      ops: Ops,
    })
    .strict(),
  undo_change: z.object({ changeSetId: uuid }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export type ToolInput<N extends ToolName> = z.output<(typeof TOOL_SCHEMAS)[N]>;
export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_SCHEMAS, name);
}

const DESCRIPTIONS: Record<ToolName, string> = {
  get_household:
    "Members (targeted or not, targets, tolerances), slots and schedules, planning weights and presets, exclusions.",
  get_plan:
    "Plan days in a date range (at most 14): meals, plates per member with fit status and macros.",
  explain_meal:
    "Why a planned meal was chosen: its score breakdown, the plate solutions and the alternatives considered.",
  search_dishes: "Search the dish library by text, cuisine key, slot key or ingredient slug.",
  get_dish:
    "A dish's full recipe: components, preparation variants, nutrition per 100 g cooked, reviews summary.",
  get_reviews: "The review feed, filtered by target, member, date and rating.",
  get_preferences:
    "Learned and explicit preferences (household-level, or one member's) with evidence counts.",
  get_proposals: "Pending and recent proposals.",
  get_change_log: "Recent change sets, newest first, with whether each can be undone.",
  generate_plan:
    "Queue plan generation for a date range (at most 14 days); locked meals are kept. Returns the job id; progress appears in the chat.",
  suggest_alternatives:
    "The top alternatives for a planned meal. `instruction` steers them; asking for something new may queue AI recipe generation.",
  create_recipe:
    "Queue AI generation of new recipe drafts for the request (default 1). The drafts appear in the chat with Save / Discard.",
  run_insights: "Run the insights engine now; its proposals appear in the chat when it finishes.",
  apply_change:
    "Apply change ops now. Only for a change the admin explicitly asked for in the current message. Protected changes become a proposal automatically. Returns the change set (with Undo) or the proposal.",
  propose_change:
    "Create a pending proposal the admin accepts or rejects. Your own ideas always go here.",
  undo_change: "Undo a change set (refused when a later change touched the same settings).",
};

/** The tool's JSON Schema from its Zod schema, without the `$schema` dialect key. */
function inputSchema(name: ToolName): BetaTool["input_schema"] {
  return withoutDialect(
    z.toJSONSchema(TOOL_SCHEMAS[name], { io: "input", unrepresentable: "any" }),
  ) as BetaTool["input_schema"];
}

/** Tool definitions in a fixed order (part of the cached prefix; ADR-1). */
export function toolDefinitions(): BetaTool[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    input_schema: inputSchema(name),
    eager_input_streaming: true,
  }));
}
