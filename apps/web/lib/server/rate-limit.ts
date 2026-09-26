// ARC-6 rate limits. Chat: turns per household per hour (CHAT_TURNS_PER_HOUR, default 30), counted
// from the household's `user` chat messages in the last hour; used by the chat route (1.3.5, R-40).
// AI recipes: dishes per household per day (AI_RECIPE_DAILY_LIMIT, default 60), counted by the
// plan services (`aiDishesToday`).
import { and, count, eq, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chatMessage } from "@mealplanner/db/schema";
import { ProblemError } from "./problem";

/** Throws 429 `rate_limited` when the household has used its chat turns for the last hour. */
export async function chatRateLimit(
  db: NodePgDatabase,
  householdId: string,
  perHour: number,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(chatMessage)
    .where(
      and(
        eq(chatMessage.householdId, householdId),
        eq(chatMessage.role, "user"),
        gte(chatMessage.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  if ((row?.n ?? 0) >= perHour)
    throw new ProblemError(
      429,
      "rate_limited",
      `the household has used its ${String(perHour)} chat turns this hour`,
    );
}
