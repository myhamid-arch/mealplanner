// GET /api/v1/methods: thin handlers over contract endpoints (lib/server/route.ts).
import { methodsList } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { listMethods } from "../../../../lib/server/reads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(methodsList, ({ rt }) => listMethods(rt));
