// GET, PUT /api/v1/account/notifications: thin handlers over contract endpoints (lib/server/route.ts).
import { accountNotifications, accountNotificationsSet } from "@mealplanner/api-contract/contract";
import { route } from "../../../../../lib/server/route";
import { accountView, setNotifications } from "../../../../../lib/server/identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route(accountNotifications, ({ rt, session }) =>
  accountView(rt, session).then((a) => ({ notifications: a.notifications })),
);
export const PUT = route(accountNotificationsSet, ({ rt, session, body }) =>
  setNotifications(rt, session, body.notifications),
);
