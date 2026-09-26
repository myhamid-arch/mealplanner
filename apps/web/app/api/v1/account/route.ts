// GET, PATCH, DELETE /api/v1/account: thin handlers over contract endpoints (lib/server/route.ts).
import { accountDelete, accountGet, accountUpdate } from "@mealplanner/api-contract/contract";
import { route } from "../../../../lib/server/route";
import { accountView, deleteAccount, renameUser } from "../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(accountGet, ({ rt, session }) => accountView(rt, session));
export const PATCH = route(accountUpdate, ({ rt, session, body }) =>
  renameUser(rt, session, body.name),
);
export const DELETE = route(accountDelete, ({ rt, session, body, request }) =>
  deleteAccount(rt, request, session, body.password).then(() => undefined),
);
