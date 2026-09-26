// POST /api/v1/households/current/deletion/confirm: thin handlers over contract endpoints (lib/server/route.ts).
import { householdDeletionConfirm } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../../lib/server/route";
import { confirmDeletion } from "../../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(householdDeletionConfirm, ({ rt, caller }) =>
  confirmDeletion(rt, caller),
);
