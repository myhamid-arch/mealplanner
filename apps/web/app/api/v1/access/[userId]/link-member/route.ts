// POST /api/v1/access/{userId}/link-member: thin handlers over contract endpoints (lib/server/route.ts).
import { accessLinkMember } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../../lib/server/route";
import { linkMember } from "../../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(accessLinkMember, ({ rt, caller, params, body }) =>
  linkMember(rt, caller, params.userId, body.memberId),
);
