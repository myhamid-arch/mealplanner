// The endpoint definition every route, test, client call and the OpenAPI document are built from
// (ARC-5: one contract). `roles` is the ARC-6 authorisation matrix row of a household endpoint.
import type { z } from "zod";
import type { HouseholdRole } from "@mealplanner/core/types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * - `public`: no session.
 * - `session`: any signed-in user (no household needed).
 * - `household`: a signed-in, active member of the selected household (SPEC-Q-2), with a role in
 *   `roles` (ARC-6).
 * - `operator`: a platform operator (R2-ADM-8), outside households.
 * - `optional`: works with or without a session (invite acceptance).
 */
export type AuthKind = "public" | "session" | "household" | "operator" | "optional";

export interface EndpointSpec {
  /** Stable id, `<area>.<action>` (client method name, OpenAPI operationId). */
  id: string;
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/v1/plan-meals/{id}/swap`. */
  path: string;
  summary: string;
  tag: string;
  auth: AuthKind;
  /** Household roles allowed (auth `household` only). */
  roles?: readonly HouseholdRole[];
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** 200 unless stated. 204 responses have no body. */
  status?: 200 | 201 | 202 | 204;
  response?: z.ZodType;
  /** `json` (default), `csv` (text/csv body) or `sse` (text/event-stream of `response` items). */
  format?: "json" | "csv" | "sse";
  /** Error statuses the endpoint can return besides 400/401/403/404/500. */
  errors?: readonly number[];
}

export type Endpoint<S extends EndpointSpec = EndpointSpec> = Readonly<S>;

export function endpoint<const S extends EndpointSpec>(spec: S): Endpoint<S> {
  if (spec.auth === "household" && (spec.roles === undefined || spec.roles.length === 0))
    throw new Error(`endpoint ${spec.id}: a household endpoint needs roles`);
  if (spec.auth !== "household" && spec.roles !== undefined)
    throw new Error(`endpoint ${spec.id}: roles apply to household endpoints only`);
  return Object.freeze(spec);
}

export const ADMIN = ["admin"] as const;
export const ADMIN_MEMBER = ["admin", "member"] as const;
export const ALL_ROLES = ["admin", "member", "kitchen"] as const;
export const ADMIN_KITCHEN = ["admin", "kitchen"] as const;

/** `/api/v1/plan-meals/{id}` → `/api/v1/plan-meals/:id` style matcher parts. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1] ?? "");
}

/** Fills a path template: `fillPath("/a/{id}", { id: "x" })` → `/a/x`. */
export function fillPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
}

export type Input<S extends EndpointSpec> = (S["params"] extends z.ZodObject
  ? { params: z.input<S["params"]> }
  : { params?: undefined }) &
  (S["query"] extends z.ZodObject ? { query?: z.input<S["query"]> } : { query?: undefined }) &
  (S["body"] extends z.ZodType ? { body: z.input<S["body"]> } : { body?: undefined });

export type Output<S extends EndpointSpec> = S["response"] extends z.ZodType
  ? z.output<S["response"]>
  : undefined;
