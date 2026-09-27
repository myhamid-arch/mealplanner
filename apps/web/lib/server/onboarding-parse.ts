// POST /api/v1/onboarding/parse (R2-ONB-3; BLD-8 R-55, R-56; leaf-1.4.7 SPEC-Q-1 … 5): one
// free-text onboarding answer read by the model through 1.3.1's structured-output client. Without
// a credential the route answers 503 and the onboarding page keeps its deterministic parse; a
// refused or failed reading is 502 (nothing of it is returned). The audit row (DM-7) is written for
// every call the model answered or failed.
import type { z } from "zod";
import { resolveClaudeConfig } from "@mealplanner/ai/client";
import {
  createOnboardingModel,
  parseOnboardingText,
  type OnboardingParseDeps,
} from "@mealplanner/ai/onboarding";
import type { OnboardingParseBody } from "@mealplanner/api-contract/contract";
import { createWriteRepos } from "@mealplanner/db/repos";
import { newId } from "@mealplanner/db/schema";
import type { CallerContext } from "../auth/context";
import { ProblemError } from "./problem";
import type { Runtime } from "./runtime";

const MODEL_KEY = Symbol.for("mealplanner.web.onboardingParseModel");
type Holder = { [MODEL_KEY]?: OnboardingParseDeps["model"] };

/** The parse model from the environment (null without a credential), or the one tests installed. */
export function onboardingParseModel(): OnboardingParseDeps["model"] {
  const holder = globalThis as Holder;
  if (!(MODEL_KEY in holder)) holder[MODEL_KEY] = createOnboardingModel(resolveClaudeConfig());
  return holder[MODEL_KEY] ?? null;
}

/** Installs a model (tests: recorded responses; null: no credential); undefined reads the env again. */
export function useOnboardingParseModel(model: OnboardingParseDeps["model"] | undefined): void {
  const holder = globalThis as Holder;
  if (model === undefined) Reflect.deleteProperty(holder, MODEL_KEY);
  else holder[MODEL_KEY] = model;
}

export async function parseOnboarding(
  rt: Runtime,
  caller: CallerContext,
  body: z.output<typeof OnboardingParseBody>,
) {
  const result = await parseOnboardingText(
    {
      model: onboardingParseModel(),
      // DM-7, as `recordAiGeneration` writes it (whose input type predates this purpose).
      recordGeneration: async (record) => {
        const id = newId();
        await createWriteRepos(rt.db, caller.ctx).ai_generation.insert({
          id,
          householdId: caller.ctx.householdId,
          ...record,
          createdAt: new Date(),
        });
        return id;
      },
    },
    {
      field: body.field,
      text: body.text,
      ...(body.people === undefined ? {} : { people: body.people }),
    },
  );
  switch (result.status) {
    case "disabled":
      throw new ProblemError(503, "model_unavailable", result.reason);
    case "failed":
      throw new ProblemError(
        502,
        result.code === "model_output_invalid" ? "model_output_invalid" : `model_${result.code}`,
        result.message,
        result.issues.length === 0
          ? undefined
          : result.issues.map((message) => ({ path: [], message })),
      );
  }
  const v = result.value;
  if (v.field === "people") return { people: v.people };
  if (v.field === "targets") return { targets: v.targets };
  return { neverEat: v.neverEat };
}
