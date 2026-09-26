// household.update (AGT-6), including the R2-ADM-6 settings (BLD-8 R-9 h).
import { z } from "zod";
import { INSIGHT_FREQUENCIES, TOLERANCE_MODES } from "../../types/index.js";
import { defineOp, definedFields, requireRow } from "../define.js";

const HouseholdUpdate = z
  .object({
    name: z.string().trim().min(1).max(120),
    locale: z.string().min(2).max(35),
    timezone: z.string().min(1).max(64),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    regionNote: z.string().max(500).nullable(),
    membersSeePlates: z.boolean(),
    agentMayApply: z.boolean(),
    requireTotpForAdmins: z.boolean(),
    kitchenSeesNames: z.boolean(),
    membersReviewForSiblings: z.boolean(),
    insightFrequency: z.enum(INSIGHT_FREQUENCIES),
    defaultPrecision: z.enum(TOLERANCE_MODES),
    satFatDefaultPct: z.number().gt(0).max(100),
  })
  .partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, "at least one field");

export const householdUpdate = defineOp({
  kind: "household.update",
  area: "household",
  schema: HouseholdUpdate,
  title: (p) => `Update household settings (${Object.keys(p).join(", ")})`,
  apply: async (tx, p) => {
    await requireRow("household.update", "household", tx.get("household", { id: tx.householdId }));
    await tx.update("household", { id: tx.householdId }, definedFields(p));
  },
});
