// GET /api/v1/portion-biases (FBK-5, FBK-9; BLD-8 R-53): a thin handler over the contract endpoint.
import { portionBiasesList } from "@mealplanner/api-contract/contract";
import { listPortionBiases } from "../../../../lib/server/portion-biases";
import { route } from "../../../../lib/server/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(portionBiasesList, ({ rt, caller, query }) =>
  listPortionBiases(rt, caller, query.memberId),
);
