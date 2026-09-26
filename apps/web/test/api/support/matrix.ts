// The G1 checks as plain functions, so the negative controls run the very same code on a faulty
// route: the route inventory against ENDPOINTS, the ARC-6 matrix (expected status per caller), the
// contract checks of a response (schema out) and of invalid input (schema in, 400).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { JobEventDto, Problem } from "@mealplanner/api-contract/contract";
import type { EndpointSpec } from "@mealplanner/api-contract/contract";
import type { HouseholdRole } from "@mealplanner/core/types";
import { ANON, call, type CallInput, type Caller } from "./app";
import type { Case, CaseArgs } from "./cases";
import { loginOf } from "./cases";
import type { World } from "./world";

// Route inventory ---------------------------------------------------------------------------------

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** `METHOD /api/v1/...` for every exported handler under `apiDir` (Next.js App Router files). */
export function routeInventory(apiDir: string, prefix = "/api/v1"): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "route.ts") {
        const rel = relative(apiDir, dir).split(sep).filter(Boolean);
        const template = [prefix, ...rel.map((s) => s.replace(/^\[(\w+)\]$/, "{$1}"))].join("/");
        const text = readFileSync(path, "utf8");
        for (const m of METHODS)
          if (new RegExp(`export\\s+(const|async function|function)\\s+${m}\\b`).test(text))
            out.push(`${m} ${template}`);
      }
    }
  };
  walk(apiDir);
  return out.sort();
}

export interface Completeness {
  /** Contract endpoints without a route handler. */
  missingRoutes: string[];
  /** Route handlers without a contract endpoint (so without contract, matrix and OpenAPI entry). */
  unregistered: string[];
}

export function completeness(routes: readonly string[], endpoints: readonly EndpointSpec[]) {
  const declared = new Set(endpoints.map((e) => `${e.method} ${e.path}`));
  const present = new Set(routes);
  return {
    missingRoutes: [...declared].filter((k) => !present.has(k)).sort(),
    unregistered: [...present].filter((k) => !declared.has(k)).sort(),
  } satisfies Completeness;
}

// Contract checks ---------------------------------------------------------------------------------

export interface Observed {
  status: number;
  contentType: string;
  text: string;
}

export async function observe(res: Response): Promise<Observed> {
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
  };
}

/** Problems with a success response: status, media type and the contract's response schema. */
export function successProblems(endpoint: EndpointSpec, o: Observed): string[] {
  const problems: string[] = [];
  const expected = endpoint.status ?? 200;
  if (o.status !== expected)
    problems.push(`status ${String(o.status)}, contract ${String(expected)}`);
  if (expected === 204) {
    if (o.text !== "") problems.push("a 204 response has a body");
    return problems;
  }
  const format = endpoint.format ?? "json";
  if (format === "csv") {
    if (!o.contentType.startsWith("text/csv")) problems.push(`content-type ${o.contentType}`);
    if (o.text.split("\r\n")[0]?.includes("id") !== true) problems.push("CSV has no header row");
    return problems;
  }
  if (format === "sse") {
    if (!o.contentType.startsWith("text/event-stream"))
      problems.push(`content-type ${o.contentType}`);
    const data = o.text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (data.length === 0) problems.push("the event stream carried no events");
    for (const d of data) {
      const parsed = JobEventDto.safeParse(JSON.parse(d));
      if (!parsed.success) problems.push(`event violates JobEventDto: ${parsed.error.message}`);
    }
    return problems;
  }
  if (!o.contentType.startsWith("application/json")) problems.push(`content-type ${o.contentType}`);
  let body: unknown;
  try {
    body = JSON.parse(o.text);
  } catch {
    problems.push("the body is not JSON");
    return problems;
  }
  if (endpoint.response !== undefined) {
    const parsed = endpoint.response.safeParse(body);
    if (!parsed.success)
      problems.push(
        `response violates the contract: ${z.prettifyError(parsed.error).slice(0, 400)}`,
      );
  }
  return problems;
}

/** Problems with an error response: RFC 7807 problem+json with the expected status. */
export function problemProblems(expected: number, o: Observed): string[] {
  const problems: string[] = [];
  if (o.status !== expected)
    problems.push(`status ${String(o.status)}, expected ${String(expected)}`);
  if (!o.contentType.startsWith("application/problem+json"))
    problems.push(`content-type ${o.contentType}`);
  try {
    const parsed = Problem.safeParse(JSON.parse(o.text));
    if (!parsed.success) problems.push("the body is not an RFC 7807 problem");
    else if (parsed.data.status !== o.status)
      problems.push("problem.status differs from the HTTP status");
  } catch {
    problems.push("the body is not JSON");
  }
  return problems;
}

/** Inputs that break the contract's request schemas (each must be refused with 400). */
export function invalidInputs(
  endpoint: EndpointSpec,
  valid: CallInput,
): Array<[string, CallInput]> {
  const out: Array<[string, CallInput]> = [];
  if (endpoint.body !== undefined) {
    out.push(["body is not JSON", { ...valid, body: undefined, rawBody: "{not json" }]);
    out.push(["body has an unknown shape", { ...valid, body: { unexpected: [1, 2, 3] } }]);
  }
  for (const name of Object.keys(endpoint.params?.shape ?? {}))
    out.push([
      `path parameter ${name} is malformed`,
      { ...valid, params: { ...(valid.params ?? {}), [name]: "not a valid value!" } },
    ]);
  if (endpoint.query !== undefined) {
    const required = Object.entries(endpoint.query.shape).filter(
      ([, s]) => !(s as z.ZodType).safeParse(undefined).success,
    );
    if (required.length > 0)
      out.push(["required query parameters are missing", { ...valid, query: {} }]);
    else {
      const [key] = Object.keys(endpoint.query.shape);
      if (key !== undefined)
        out.push([
          `query parameter ${key} is malformed`,
          { ...valid, query: { ...(valid.query ?? {}), [key]: "x".repeat(1000) } },
        ]);
    }
  }
  return out;
}

// The ARC-6 matrix --------------------------------------------------------------------------------

export type CallerKey =
  | "anonymous"
  | "blocked login"
  | "operator without household"
  | "household admin"
  | "household member"
  | "household kitchen"
  | "other household's admin, naming this household"
  | "other household's admin, with this household's ids"
  | "household admin (not an operator)";

export interface Outcome {
  endpoint: string;
  caller: string;
  expected: number;
  status: number;
  problems: string[];
}

export type Invoke = (
  endpoint: EndpointSpec,
  input: CallInput,
  caller: Caller,
  headers?: Record<string, string>,
) => Promise<Response>;

export const realInvoke: Invoke = call;

const ROLES: readonly HouseholdRole[] = ["admin", "member", "kitchen"];

/** Path parameters that name a household-scoped row (a foreign household must see 404). */
function scopedParams(endpoint: EndpointSpec): boolean {
  if (endpoint.auth !== "household") return false;
  const names = Object.keys(endpoint.params?.shape ?? {});
  return names.some((n) => n === "id" || n === "userId");
}

/** Ids of household A that must never appear in another household's responses. */
export function secretsOf(w: World): string[] {
  return [
    w.a.id,
    w.a.adultId,
    w.a.childId,
    w.a.planMealId,
    w.a.plateId,
    w.a.planDayId,
    w.a.reviewId,
    w.a.proposalId,
    w.a.conversationId,
    w.a.jobId,
    w.a.inviteId,
    w.a.changeSetId,
    w.a.admin.userId,
    w.a.member.userId,
    w.a.kitchen.userId,
    w.a.admin.email,
    w.a.ownIngredientId,
    w.a.ownDishId,
  ];
}

async function one(
  invoke: Invoke,
  endpoint: EndpointSpec,
  input: CallInput,
  caller: Caller,
  label: string,
  expected: number,
  headers?: Record<string, string>,
): Promise<Outcome> {
  const o = await observe(await invoke(endpoint, input, caller, headers));
  const problems = expected < 300 ? successProblems(endpoint, o) : problemProblems(expected, o);
  if (problems.length > 0) problems.push(`body: ${o.text.slice(0, 300)}`);
  return { endpoint: endpoint.id, caller: label, expected, status: o.status, problems };
}

/**
 * Runs one endpoint through the matrix: every refused caller first (with the input of a valid
 * admin call, so a refusal that had side effects would break the valid call that follows), the
 * contract's invalid inputs, then the valid call of every allowed role, then the leak check.
 */
export async function runMatrix(
  endpoint: EndpointSpec,
  make: Case,
  args: Omit<CaseArgs, "who">,
  invoke: Invoke = realInvoke,
): Promise<Outcome[]> {
  const { w } = args;
  const out: Outcome[] = [];
  const first = await make({ ...args, who: "admin" });
  const input = first.input;
  const run = (
    caller: Caller,
    label: string,
    expected: number,
    headers?: Record<string, string>,
    inp = input,
  ) =>
    one(invoke, endpoint, inp, caller, label, expected, headers).then((r) => {
      out.push(r);
      return r;
    });

  if (endpoint.auth === "household") {
    const roles = endpoint.roles ?? [];
    await run(ANON, "anonymous", 401);
    await run(w.a.blocked, "blocked login", 401);
    await run({ token: w.operator.token }, "operator without household", 403);
    for (const role of ROLES)
      if (!roles.includes(role)) await run(loginOf(w, role), `household ${role}`, 403);
    await run(w.b.admin, "other household's admin, naming this household", 404, {
      "x-household-id": w.a.id,
    });
    if (scopedParams(endpoint))
      await run(w.b.admin, "other household's admin, with this household's ids", 404);
    const valid = first.caller ?? w.a.admin;
    for (const [what, bad] of invalidInputs(endpoint, input))
      await run(valid, `admin with invalid input (${what})`, 400, undefined, bad);
    await run(valid, "household admin", endpoint.status ?? 200);
    for (const role of ROLES)
      if (role !== "admin" && roles.includes(role)) {
        const v = await make({ ...args, who: role });
        await run(
          v.caller ?? loginOf(w, role),
          `household ${role}`,
          endpoint.status ?? 200,
          undefined,
          v.input,
        );
      }
    if (endpoint.method === "GET" && endpoint.params === undefined) {
      const o = await observe(await invoke(endpoint, input, w.b.admin));
      const leaked = secretsOf(w).filter((s) => o.text.includes(s));
      out.push({
        endpoint: endpoint.id,
        caller: "other household's admin, own household (no data of this household)",
        expected: endpoint.status ?? 200,
        status: o.status,
        problems: [
          ...successProblems(endpoint, o),
          ...leaked.map((s) => `leaked id ${s} of household A`),
        ],
      });
    }
    return out;
  }

  const caller = first.caller ?? ANON;
  if (endpoint.auth === "session") {
    await run(ANON, "anonymous", 401);
    await run(w.a.blocked, "blocked login", 401);
  }
  if (endpoint.auth === "operator") {
    await run(ANON, "anonymous", 401);
    await run(w.a.blocked, "blocked login", 401);
    await run(w.a.admin, "household admin (not an operator)", 403);
    await run(w.b.admin, "other household's admin (not an operator)", 403);
  }
  for (const [what, bad] of invalidInputs(endpoint, input))
    await run(caller, `valid caller with invalid input (${what})`, 400, undefined, bad);
  await run(
    caller,
    endpoint.auth === "operator"
      ? "operator"
      : endpoint.auth === "session"
        ? "signed-in user"
        : "anonymous",
    endpoint.status ?? 200,
  );
  return out;
}
