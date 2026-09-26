// POST /api/v1/signup: thin handlers over contract endpoints (lib/server/route.ts).
import { signup } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { signupUser } from "../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = route(signup, ({ rt, body }) => signupUser(rt, body));
