// `plan.generate` (ARC-7, PLN-11/12, R-2): plan the dates with the planner, build the cook sheet,
// save both as one change set, and turn PLN-12 `ask` triggers into proposals. `requestDishes` (the
// recipe generator through its ports) is passed only in `auto` mode by the worker; `off`, or no
// credential, requests nothing (REC-2).
import {
  buildCookSheet,
  planDays,
  type PlanDish,
  type PlanGenerationRequest,
  type PlanProgress,
  type PlanResult,
} from "@mealplanner/core/planner";
import type { ProposalDraft } from "@mealplanner/core/learning/rules";
import type { HouseholdContext } from "@mealplanner/core/types";
import type { Executor } from "../../repos/index.js";
import { createProposals, type ProposalRow } from "../proposals/index.js";
import { loadPlanInput, type PlanPool } from "./load-input.js";
import { savePlan, type ChangeActorInput } from "./store.js";

export interface GeneratePlanArgs {
  dates: readonly string[];
  seed: number;
  by: ChangeActorInput;
  onProgress?: (e: PlanProgress) => void;
  /** PLN-12 `auto`: new dishes for a triggered slot (saved by the caller, returned as PlanDish). */
  requestDishes?: (request: PlanGenerationRequest, pool: PlanPool) => Promise<PlanDish[]>;
  now?: Date;
}

export interface GeneratePlanResult {
  plan: PlanResult;
  changeSetId: string;
  /** PLN-12 `ask`: the "generate new recipes" proposals stored. */
  proposals: ProposalRow[];
}

/** PLN-12 `ask`: one proposal per triggered slot and date. */
export function generationProposal(
  request: PlanGenerationRequest,
  slotLabel: string,
): ProposalDraft {
  return {
    origin: "rule",
    title: `Generate ${String(request.count)} new ${slotLabel.toLowerCase()} recipes`,
    rationale: `For ${slotLabel.toLowerCase()} on ${request.date}: ${request.reason}.`,
    ops: [
      {
        kind: "recipe.generate",
        payload: {
          date: request.date,
          slotKey: request.slotKey,
          count: request.count,
          reason: request.reason.slice(0, 500),
        },
      },
    ],
    evidence: { reviewIds: [], count: 1, metrics: {} },
    priority: 3,
  };
}

export async function generatePlan(
  db: Executor,
  ctx: HouseholdContext,
  args: GeneratePlanArgs,
): Promise<GeneratePlanResult> {
  const { input, pool } = await loadPlanInput(db, ctx, { dates: args.dates });
  const requestDishes = args.requestDishes;
  const plan = await planDays(input, {
    seed: args.seed,
    ...(args.onProgress === undefined ? {} : { onProgress: args.onProgress }),
    ...(requestDishes === undefined
      ? {}
      : { requestDishes: (r: PlanGenerationRequest) => requestDishes(r, pool) }),
  });
  // Dishes generated during the run joined the planner's pool; the save validates against them.
  for (const d of Object.values(plan.dishes)) if (!pool.byId.has(d.id)) pool.byId.set(d.id, d);
  const sheet = buildCookSheet(plan, pool.catalog.context);
  const saved = await savePlan(db, ctx, {
    plan,
    sheet,
    pool,
    by: args.by,
    ...(args.now === undefined ? {} : { now: args.now }),
  });
  const asks = plan.generationRequests.filter((r) => plan.weights[r.date]?.aiGeneration === "ask");
  let proposals: ProposalRow[] = [];
  if (asks.length > 0) {
    const labels = new Map(input.config.slotTypes.map((s) => [s.key, s.label]));
    const result = await createProposals(
      db,
      ctx,
      asks.map((r) => generationProposal(r, labels.get(r.slotKey) ?? r.slotKey)),
      args.now === undefined ? {} : { now: args.now },
    );
    proposals = result.stored;
  }
  return { plan, changeSetId: saved.changeSetId, proposals };
}
