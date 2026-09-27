// POST /api/v1/plans/preview (UX-4; BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-6): queues the
// `plans.preview` job, a what-if plan with other weights that writes no plan. Its result (the
// current and proposed figures and the meals that would change) is the job's `done` event.
import type { z } from "zod";
import type { PlanPreviewBody } from "@mealplanner/api-contract/contract";
import type { CallerContext } from "../auth/context";
import { enqueueJob } from "./jobs";
import type { Runtime } from "./runtime";

export async function previewPlan(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof PlanPreviewBody>,
) {
  const jobId = await enqueueJob(rt.db, rt.queue, {
    kind: "plans.preview",
    householdId: caller.ctx.householdId,
    payload: { dates: [...new Set(body.dates)].sort(), weights: body.weights, seed: body.seed },
    createdByUserId: caller.ctx.userId,
  });
  return { jobId };
}
