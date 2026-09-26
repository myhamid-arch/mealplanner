// RFC 7807 problem+json responses (ARC-5). Every error a route returns goes through here.
import type { Problem } from "@mealplanner/api-contract/contract";

export const PROBLEM_TYPE = "https://mealplanner.invalid/problems/";

const TITLES: Record<number, string> = {
  400: "Bad request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not found",
  409: "Conflict",
  410: "Gone",
  422: "Unprocessable change",
  429: "Too many requests",
  500: "Internal server error",
  503: "Service unavailable",
};

/** An error that is answered with a problem response. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail?: string,
    readonly issues?: Problem["issues"],
  ) {
    super(detail ?? code);
    this.name = "ProblemError";
  }

  toProblem(instance?: string): Problem {
    return {
      type: `${PROBLEM_TYPE}${this.code}`,
      title: TITLES[this.status] ?? "Error",
      status: this.status,
      code: this.code,
      ...(this.message === this.code ? {} : { detail: this.message }),
      ...(instance === undefined ? {} : { instance }),
      ...(this.issues === undefined ? {} : { issues: this.issues }),
    };
  }
}

export function problemResponse(
  error: ProblemError,
  instance?: string,
  headers?: HeadersInit,
): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/problem+json");
  return new Response(JSON.stringify(error.toProblem(instance)), {
    status: error.status,
    headers: h,
  });
}

export const unauthorized = (detail = "sign in to continue") =>
  new ProblemError(401, "unauthorized", detail);
export const forbidden = (code = "forbidden", detail?: string) =>
  new ProblemError(403, code, detail);
export const notFound = (what = "resource") =>
  new ProblemError(404, "not_found", `${what} not found`);
export const conflict = (code: string, detail?: string) => new ProblemError(409, code, detail);
export const unprocessable = (code: string, detail?: string) => new ProblemError(422, code, detail);
