// Activity-chip labels (AGT-7: "Checking next week's plan…").
import type { ToolName } from "./schemas.js";

export const TOOL_LABELS: Record<ToolName, string> = {
  get_household: "Reading the household…",
  get_plan: "Checking the plan…",
  explain_meal: "Looking into that meal…",
  search_dishes: "Searching the recipes…",
  get_dish: "Opening the recipe…",
  get_reviews: "Reading reviews…",
  get_preferences: "Checking preferences…",
  get_proposals: "Checking proposals…",
  get_change_log: "Reading the change log…",
  generate_plan: "Starting the planner…",
  suggest_alternatives: "Finding alternatives…",
  create_recipe: "Starting recipe ideas…",
  run_insights: "Starting the insights run…",
  apply_change: "Applying the change…",
  propose_change: "Preparing a proposal…",
  undo_change: "Undoing the change…",
};

export function toolLabel(name: string): string {
  return (TOOL_LABELS as Record<string, string | undefined>)[name] ?? "Working…";
}
