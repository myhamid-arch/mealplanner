// `route(endpoint, handler)`: every /api/v1 route handler is built here (ARC-4, ARC-5, ARC-6;
// leaf-1.4.1 ADR-3). In order: request id and log line, authentication and the ARC-6 role row of
// the endpoint's contract, path/query/body parsing against the contract (400 with issues), the
// handler (services only, no business logic), serialisation through the contract's response
// schema, and mapping of typed service errors to RFC 7807 problems.
import { randomUUID } from "node:crypto";
import { ZodError, type z } from "zod";
import type { EndpointSpec } from "@mealplanner/api-contract/contract";
import {
  AlreadyUndoneError,
  ChangeConflictError,
  ChangeOpError,
  ChangeSetNotFoundError,
  ChangeValidationError,
  LastAdminError,
  ProtectedOperationError,
} from "@mealplanner/db/services/changes";
import {
  ProposalNotFoundError,
  ProposalPayloadError,
  ProposalPermissionError,
  ProposalStateError,
} from "@mealplanner/db/services/proposals";
import {
  ReviewEditWindowError,
  ReviewNotFoundError,
  ReviewPermissionError,
  ReviewTargetError,
  ReviewValidationError,
} from "@mealplanner/db/services/reviews";
import { PlanServiceError } from "@mealplanner/db/services/plans";
import {
  CrossHouseholdError,
  GlobalRowReadOnlyError,
  RowNotFoundError,
} from "@mealplanner/db/repos";
import {
  readSession,
  requireHousehold,
  requireOperator,
  requireSession,
  type CallerContext,
  type SessionInfo,
} from "../auth/context";
import { logger, type Logger } from "./log";
import { ProblemError, problemResponse } from "./problem";
import { runtime, type Runtime } from "./runtime";

/** A handler result with an explicit status or extra headers (cookies from sign-in). */
export class Reply<T> {
  constructor(
    readonly body: T,
    readonly init: { status?: number; headers?: HeadersInit } = {},
  ) {}
}

type Parsed<S extends EndpointSpec, K extends "params" | "query" | "body"> = S[K] extends z.ZodType
  ? z.output<S[K]>
  : undefined;

type Out<S extends EndpointSpec> = S["response"] extends z.ZodType
  ? z.input<S["response"]>
  : undefined;

export interface HandlerArgs<S extends EndpointSpec> {
  request: Request;
  rt: Runtime;
  log: Logger;
  params: Parsed<S, "params">;
  query: Parsed<S, "query">;
  body: Parsed<S, "body">;
  /** Present for `household` endpoints. */
  caller: S["auth"] extends "household" ? CallerContext : undefined;
  /** Present for `session`, `operator`, and (when signed in) `optional` endpoints. */
  session: S["auth"] extends "session" | "operator" ? SessionInfo : SessionInfo | null;
}

type Handler<S extends EndpointSpec> = (
  args: HandlerArgs<S>,
) => Promise<Out<S> | Reply<Out<S>> | Response>;

type RouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

export interface RouteOptions {
  /** Admin endpoints that must stay usable to set up TOTP (none today; account routes are session). */
  allowWithoutTotp?: boolean;
}

function issuesOf(error: ZodError) {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: i.message,
  }));
}

/** Maps a thrown error to a problem (unknown errors become 500 and are logged). */
export function toProblem(error: unknown, log: Logger): ProblemError {
  if (error instanceof ProblemError) return error;
  if (error instanceof ZodError)
    return new ProblemError(400, "invalid_request", "the request is invalid", issuesOf(error));
  if (error instanceof ChangeValidationError)
    return new ProblemError(
      400,
      "invalid_op",
      error.message,
      error.issues.map((i) => ({
        path: [`ops`, error.index, ...i.path.map(String)],
        message: i.message,
      })),
    );
  if (error instanceof CrossHouseholdError || error instanceof RowNotFoundError)
    return new ProblemError(404, "not_found", "not found");
  if (error instanceof GlobalRowReadOnlyError)
    return new ProblemError(422, "read_only", error.message);
  if (error instanceof LastAdminError) return new ProblemError(409, "last_admin", error.message);
  if (error instanceof ChangeConflictError)
    return new ProblemError(409, "undo_conflict", error.message);
  if (error instanceof AlreadyUndoneError)
    return new ProblemError(409, "already_undone", error.message);
  if (error instanceof ChangeSetNotFoundError)
    return new ProblemError(404, "not_found", error.message);
  if (error instanceof ProtectedOperationError)
    return new ProblemError(403, "protected_op", error.message);
  if (error instanceof ChangeOpError) return new ProblemError(422, "change_refused", error.message);
  if (error instanceof ProposalNotFoundError || error instanceof ReviewNotFoundError)
    return new ProblemError(404, "not_found", error.message);
  if (error instanceof ProposalStateError)
    return new ProblemError(409, "proposal_state", error.message);
  if (error instanceof ProposalPermissionError || error instanceof ReviewPermissionError)
    return new ProblemError(403, "forbidden", error.message);
  if (error instanceof ProposalPayloadError)
    return new ProblemError(422, "proposal_invalid", error.message);
  if (error instanceof ReviewEditWindowError)
    return new ProblemError(409, "edit_window_closed", error.message);
  if (error instanceof ReviewTargetError || error instanceof ReviewValidationError)
    return new ProblemError(422, "review_invalid", error.message);
  if (error instanceof PlanServiceError)
    return new ProblemError(
      error.code === "not_found" ? 404 : error.code === "limit" ? 429 : 422,
      `plan_${error.code}`,
      error.message,
    );
  // PostgreSQL: the job trigger (R-40) and constraint violations from concurrent writes.
  const code =
    (error as { code?: unknown; cause?: { code?: unknown } } | null)?.cause?.code ??
    (error as { code?: unknown } | null)?.code;
  if (code === "55006") return new ProblemError(409, "job_started", "the job has already started");
  if (code === "23505") return new ProblemError(409, "duplicate", "a conflicting row exists");
  log.error({ err: error }, "unhandled error");
  return new ProblemError(500, "internal_error", "an unexpected error occurred");
}

async function paramsOf(context: RouteContext | undefined): Promise<Record<string, string>> {
  const raw = context === undefined ? {} : await context.params;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out;
}

async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProblemError(400, "invalid_json", "the body is not valid JSON");
  }
}

function json(value: unknown, status: number, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: h });
}

/** Builds the route handler of one contract endpoint. */
export function route<S extends EndpointSpec>(
  endpoint: S,
  handler: Handler<S>,
  options: RouteOptions = {},
) {
  return async (request: Request, context?: RouteContext): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    let log = logger.child({ requestId, endpoint: endpoint.id });
    const started = performance.now();
    let status = 500;
    try {
      const rt = runtime();
      let caller: CallerContext | undefined;
      let session: SessionInfo | null = null;
      if (endpoint.auth === "household") {
        caller = await requireHousehold(rt, request, endpoint.roles ?? [], {
          allowWithoutTotp: options.allowWithoutTotp === true,
        });
        session = caller;
        log = log.child({ householdId: caller.ctx.householdId, userId: caller.ctx.userId });
      } else if (endpoint.auth === "session") {
        session = await requireSession(rt, request);
        log = log.child({ userId: session.user.id });
      } else if (endpoint.auth === "operator") {
        session = await requireOperator(rt, request);
        log = log.child({ operatorId: session.user.id });
      } else if (endpoint.auth === "optional") {
        session = await readSession(rt, request);
      }
      const params =
        endpoint.params === undefined ? undefined : endpoint.params.parse(await paramsOf(context));
      const url = new URL(request.url);
      const query =
        endpoint.query === undefined
          ? undefined
          : endpoint.query.parse(Object.fromEntries(url.searchParams));
      const body =
        endpoint.body === undefined ? undefined : endpoint.body.parse(await bodyOf(request));
      const result = await handler({
        request,
        rt,
        log,
        params,
        query,
        body,
        caller,
        session,
      } as HandlerArgs<S>);
      if (result instanceof Response) {
        status = result.status;
        return result;
      }
      const reply = result instanceof Reply ? result : new Reply(result);
      status = reply.init.status ?? endpoint.status ?? 200;
      if (status === 204) return new Response(null, { status, headers: reply.init.headers });
      let out: unknown = reply.body;
      if (endpoint.response !== undefined) {
        const checked = endpoint.response.safeParse(reply.body);
        if (!checked.success) {
          log.error({ issues: checked.error.issues.slice(0, 5) }, "response violates its contract");
          throw new ProblemError(
            500,
            "response_invalid",
            "the response does not match the API contract",
          );
        }
        out = checked.data;
      }
      return json(out, status, reply.init.headers);
    } catch (error) {
      const problem = toProblem(error, log);
      status = problem.status;
      return problemResponse(problem, new URL(request.url).pathname, { "x-request-id": requestId });
    } finally {
      log.info(
        { status, ms: Math.round(performance.now() - started) },
        `${endpoint.method} ${endpoint.path}`,
      );
    }
  };
}
