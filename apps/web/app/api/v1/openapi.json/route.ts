// GET /api/v1/openapi.json: thin handlers over contract endpoints (lib/server/route.ts).
import { openapiGet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { openApiDocument } from "../../../../lib/server/openapi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(openapiGet, () => Promise.resolve(openApiDocument()));
