// Household settings, data export, deletion with a 14-day grace, and support grants (R2-ADM-6,
// R2-ADM-8; leaf-1.4.1 SPEC-Q-7, -16, -18). Deletion fields are household lifecycle state, written
// directly (not an undoable configuration change); cancelling is the explicit DELETE.
import { and, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import type { Json } from "@mealplanner/core/types";
import { HOUSEHOLD_TABLES, TABLES, columnsOf, createRepos } from "@mealplanner/db/repos";
import { household, platformOperator, supportGrant, user } from "@mealplanner/db/schema";
import { activeAdminCount, applyChangeSet } from "@mealplanner/db/services/changes";
import type { CallerContext } from "../auth/context";
import { conflict, notFound, ProblemError } from "./problem";
import type { Runtime } from "./runtime";
import { iso, plain } from "./serialize";

export const DELETION_GRACE_MS = 14 * 86_400_000;

type HouseholdRow = typeof household.$inferSelect;

export function householdDto(h: HouseholdRow) {
  return plain(h);
}

export function deletionDto(h: HouseholdRow) {
  const confirmed = h.deletionConfirmedAt;
  return {
    requestedAt: iso(h.deletionRequestedAt),
    requestedByUserId: h.deletionRequestedByUserId,
    confirmedAt: iso(confirmed),
    confirmedByUserId: h.deletionConfirmedByUserId,
    awaitingSecondAdmin: h.deletionRequestedAt !== null && confirmed === null,
    purgeAfter:
      confirmed === null ? null : new Date(confirmed.getTime() + DELETION_GRACE_MS).toISOString(),
  };
}

async function reload(rt: Runtime, householdId: string): Promise<HouseholdRow> {
  const [h] = await rt.db.select().from(household).where(eq(household.id, householdId));
  if (h === undefined) throw notFound("household");
  return h;
}

/** Request deletion: the grace starts now with one admin, or after a second admin confirms. */
export async function requestDeletion(rt: Runtime, caller: CallerContext) {
  const h = caller.household;
  if (h.deletionRequestedAt !== null)
    throw conflict("deletion_requested", "deletion is already requested");
  const now = new Date();
  const single = (await activeAdminCount(rt.db, h.id)) <= 1;
  await rt.db
    .update(household)
    .set({
      deletionRequestedAt: now,
      deletionRequestedByUserId: caller.ctx.userId,
      deletionConfirmedAt: single ? now : null,
      deletionConfirmedByUserId: single ? caller.ctx.userId : null,
    })
    .where(and(eq(household.id, h.id), isNull(household.deletionRequestedAt)));
  return deletionDto(await reload(rt, h.id));
}

export async function confirmDeletion(rt: Runtime, caller: CallerContext) {
  const h = caller.household;
  if (h.deletionRequestedAt === null)
    throw conflict("no_deletion_request", "no deletion is requested");
  if (h.deletionConfirmedAt !== null)
    throw conflict("deletion_confirmed", "the deletion is already confirmed");
  if (h.deletionRequestedByUserId === caller.ctx.userId)
    throw conflict("second_admin_required", "a different admin must confirm the deletion");
  await rt.db
    .update(household)
    .set({ deletionConfirmedAt: new Date(), deletionConfirmedByUserId: caller.ctx.userId })
    .where(and(eq(household.id, h.id), isNull(household.deletionConfirmedAt)));
  return deletionDto(await reload(rt, h.id));
}

export async function cancelDeletion(rt: Runtime, caller: CallerContext) {
  await rt.db
    .update(household)
    .set({
      deletionRequestedAt: null,
      deletionRequestedByUserId: null,
      deletionConfirmedAt: null,
      deletionConfirmedByUserId: null,
    })
    .where(eq(household.id, caller.ctx.householdId));
  return deletionDto(await reload(rt, caller.ctx.householdId));
}

/** Households whose grace has passed (the purge job). */
export async function householdsDue(rt: Runtime, now = new Date()) {
  return rt.db
    .select({ id: household.id })
    .from(household)
    .where(
      and(
        isNotNull(household.deletionConfirmedAt),
        lt(household.deletionConfirmedAt, new Date(now.getTime() - DELETION_GRACE_MS)),
      ),
    );
}

// Export (SPEC-Q-18) -----------------------------------------------------------------------------

/** Tables in an export: every household-owned table (auth tables are not reachable here). */
function exportTables(): string[] {
  return HOUSEHOLD_TABLES.filter((t) => t !== "kg_node" && t !== "kg_edge").sort();
}

async function tableRows(
  rt: Runtime,
  caller: CallerContext,
  table: string,
): Promise<Record<string, unknown>[]> {
  const repos = createRepos(rt.db, caller.ctx) as unknown as Record<
    string,
    { list(): Promise<Record<string, unknown>[]> }
  >;
  const repo = repos[table];
  if (repo === undefined) throw notFound(`table ${table}`);
  const spec = TABLES[table as keyof typeof TABLES];
  const key = spec.householdKey ?? "householdId";
  const rows = await repo.list();
  // Shared tables also return global seed rows; an export holds only the household's own.
  return spec.scope === "shared" ? rows.filter((r) => r[key] === caller.ctx.householdId) : rows;
}

export async function exportJson(rt: Runtime, caller: CallerContext) {
  const tables: Record<string, Record<string, Json>[]> = {};
  for (const t of exportTables())
    tables[t] = plain(await tableRows(rt, caller, t)) as Record<string, Json>[];
  return { exportedAt: new Date().toISOString(), householdId: caller.ctx.householdId, tables };
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function exportCsv(
  rt: Runtime,
  caller: CallerContext,
  table: string,
): Promise<Response> {
  if (!exportTables().includes(table)) throw notFound(`table ${table}`);
  const rows = await tableRows(rt, caller, table);
  const columns = Object.keys(columnsOf(TABLES[table as keyof typeof TABLES]));
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
  ];
  return new Response(`${lines.join("\r\n")}\r\n`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${table}.csv"`,
      "cache-control": "no-store",
    },
  });
}

// Support grants (R2-ADM-8) ----------------------------------------------------------------------

type GrantRow = typeof supportGrant.$inferSelect;

function grantDto(g: GrantRow, operatorEmail: string, now = new Date()) {
  return {
    id: g.id,
    operatorUserId: g.operatorUserId,
    operatorEmail,
    grantedByUserId: g.grantedByUserId,
    createdAt: g.createdAt.toISOString(),
    expiresAt: g.expiresAt.toISOString(),
    revokedAt: iso(g.revokedAt),
    active: g.revokedAt === null && g.expiresAt > now,
  };
}

async function grantsWithEmail(rt: Runtime, householdId: string) {
  return rt.db
    .select({ grant: supportGrant, email: user.email })
    .from(supportGrant)
    .innerJoin(user, eq(user.id, supportGrant.operatorUserId))
    .where(eq(supportGrant.householdId, householdId))
    .orderBy(desc(supportGrant.createdAt));
}

export async function listGrants(rt: Runtime, caller: CallerContext) {
  return {
    grants: (await grantsWithEmail(rt, caller.ctx.householdId)).map((r) =>
      grantDto(r.grant, r.email),
    ),
  };
}

export async function createGrant(
  rt: Runtime,
  caller: CallerContext,
  body: { operatorEmail: string; hours: number },
) {
  const [op] = await rt.db
    .select({ userId: platformOperator.userId })
    .from(platformOperator)
    .innerJoin(user, eq(user.id, platformOperator.userId))
    .where(eq(user.email, body.operatorEmail));
  if (op === undefined)
    throw new ProblemError(422, "unknown_operator", "no platform operator has that email");
  const expiresAt = new Date(Date.now() + body.hours * 3_600_000);
  await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: `Grant support access for ${String(body.hours)} h`,
    ops: [
      {
        kind: "support.grant",
        payload: { operatorUserId: op.userId, expiresAt: expiresAt.toISOString() },
      },
    ],
  });
  const [row] = (await grantsWithEmail(rt, caller.ctx.householdId)).filter(
    (r) => r.grant.operatorUserId === op.userId,
  );
  if (row === undefined) throw new Error("grant not stored");
  return grantDto(row.grant, row.email);
}

export async function revokeGrant(rt: Runtime, caller: CallerContext, grantId: string) {
  await applyChangeSet(rt.db, caller.ctx, {
    actor: "user",
    source: "ui",
    summary: "Revoke support access",
    ops: [{ kind: "support.revoke", payload: { grantId } }],
  });
  const row = (await grantsWithEmail(rt, caller.ctx.householdId)).find(
    (r) => r.grant.id === grantId,
  );
  if (row === undefined) throw notFound("support grant");
  return grantDto(row.grant, row.email);
}
