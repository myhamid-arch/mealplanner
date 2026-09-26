// GET, POST, DELETE /api/v1/households/current/deletion: thin handlers over contract endpoints (lib/server/route.ts).
import {
  householdDeletion,
  householdDeletionCancel,
  householdDeletionRequest,
} from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import {
  cancelDeletion,
  deletionDto,
  requestDeletion,
} from "../../../../../../lib/server/household";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A suspended household's admins can still see and cancel a deletion (SPEC-Q-16).
export const GET = route(
  householdDeletion,
  ({ caller }) => Promise.resolve(deletionDto(caller.household)),
  { allowSuspended: true },
);
export const POST = route(householdDeletionRequest, ({ rt, caller }) =>
  requestDeletion(rt, caller),
);
export const DELETE = route(
  householdDeletionCancel,
  ({ rt, caller }) => cancelDeletion(rt, caller),
  { allowSuspended: true },
);
