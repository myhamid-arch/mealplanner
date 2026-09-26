// ARC-4: every service call carries the household it acts for and who is acting.
import type { HouseholdRole } from "./enums.js";

export interface HouseholdContext {
  householdId: string;
  /** The acting login; null for system jobs (learning, plan generation, fixtures). */
  userId: string | null;
  /** The acting login's role in the household, or `system` for background jobs. */
  role: HouseholdRole | "system";
}
