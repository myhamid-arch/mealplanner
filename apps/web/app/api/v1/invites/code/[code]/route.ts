// GET /api/v1/invites/code/{code}: thin handlers over contract endpoints (lib/server/route.ts).
import { invitesLookup } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { lookupInvite } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(invitesLookup, ({ rt, params }) => lookupInvite(rt, params.code));
