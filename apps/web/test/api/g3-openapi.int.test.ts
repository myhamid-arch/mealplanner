// G3: the OpenAPI 3.1 document is generated from the contract and is valid. Validation uses
// @readme/openapi-parser (the OpenAPI 3.1 schema, plus duplicate operationIds, parameters and
// $ref resolution). Coverage: every contract endpoint and every route file has its operation, with
// path and query parameters, request body, success response and media type, every error status it
// declares, security and the ARC-6 roles. The served /api/v1/openapi.json is the same document.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, compileErrors } from "@readme/openapi-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ENDPOINTS,
  openapiGet,
  pathParams,
  type EndpointSpec,
} from "@mealplanner/api-contract/contract";
import { buildOpenApiDocument } from "@mealplanner/api-contract/openapi";
import { ANON, callJson, startTestApp, type TestApp } from "./support/app";
import { createTestDatabase, type TestDatabase } from "./support/db";
import { routeInventory } from "./support/matrix";
import { measure } from "./support/measure";

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/api/v1");

type Doc = {
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
};
type Operation = {
  operationId: string;
  parameters: Array<{ name: string; in: string; required: boolean }>;
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { content?: Record<string, unknown> }>;
  security: unknown[];
  "x-roles": string[];
};

/** Coverage problems of a document against the contract (the checks the negative controls reuse). */
function coverageProblems(doc: Doc, endpoints: readonly EndpointSpec[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const e of endpoints) {
    const op = doc.paths[e.path]?.[e.method.toLowerCase()];
    const at = `${e.method} ${e.path}`;
    if (op === undefined) {
      problems.push(`${at}: no operation`);
      continue;
    }
    if (op.operationId !== e.id) problems.push(`${at}: operationId ${op.operationId}`);
    if (ids.has(op.operationId)) problems.push(`${at}: duplicate operationId`);
    ids.add(op.operationId);
    for (const name of pathParams(e.path))
      if (!op.parameters.some((p) => p.in === "path" && p.name === name && p.required))
        problems.push(`${at}: path parameter ${name} missing`);
    for (const [name, schema] of Object.entries(e.query?.shape ?? {})) {
      const p = op.parameters.find((q) => q.in === "query" && q.name === name);
      if (p === undefined) problems.push(`${at}: query parameter ${name} missing`);
      else if (
        p.required !==
        !(schema as { safeParse(v: unknown): { success: boolean } }).safeParse(undefined).success
      )
        problems.push(`${at}: query parameter ${name} required flag`);
    }
    if ((e.body !== undefined) !== (op.requestBody?.content["application/json"] !== undefined))
      problems.push(`${at}: request body`);
    const status = String(e.status ?? 200);
    const success = op.responses[status];
    const media =
      e.status === 204
        ? null
        : e.format === "csv"
          ? "text/csv"
          : e.format === "sse"
            ? "text/event-stream"
            : "application/json";
    if (success === undefined) problems.push(`${at}: no ${status} response`);
    else if (media !== null && success.content?.[media] === undefined)
      problems.push(`${at}: ${status} response is not ${media}`);
    const errors = [
      400,
      ...(e.errors ?? []),
      ...(e.auth === "public" ? [] : [401]),
      ...(e.auth === "household" || e.auth === "operator" ? [403, 404] : []),
    ];
    for (const code of errors) {
      const r = op.responses[String(code)];
      if (r?.content?.["application/problem+json"] === undefined)
        problems.push(`${at}: no problem+json ${String(code)} response`);
    }
    if ((e.auth === "public") !== (op.security.length === 0)) problems.push(`${at}: security`);
    const roles = e.auth === "household" ? [...(e.roles ?? [])] : [e.auth];
    if (JSON.stringify(op["x-roles"]) !== JSON.stringify(roles)) problems.push(`${at}: x-roles`);
  }
  return problems;
}

async function validity(doc: unknown): Promise<{ valid: boolean; errors: string }> {
  const result = await validate(structuredClone(doc) as never);
  return { valid: result.valid, errors: result.valid ? "" : compileErrors(result) };
}

let db: TestDatabase;
let app: TestApp;

beforeAll(async () => {
  db = await createTestDatabase({ seed: false });
  app = startTestApp(db.url);
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.drop();
});

describe("G3 OpenAPI", () => {
  it("G3 the generated OpenAPI 3.1 document is valid", async () => {
    const doc = buildOpenApiDocument() as Doc;
    const v = await validity(doc);
    measure("G3", "validity", {
      openapi: doc.openapi,
      valid: v.valid,
      paths: Object.keys(doc.paths).length,
      operations: Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0),
      schemas: Object.keys(doc.components.schemas).length,
    });
    expect(v.errors).toBe("");
    expect(v.valid).toBe(true);
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it("G3 every contract endpoint and route file is in the document with parameters, bodies, responses, security and roles", () => {
    const doc = buildOpenApiDocument() as Doc;
    const problems = coverageProblems(doc, ENDPOINTS);
    const routes = routeInventory(API_DIR);
    const undocumented = routes.filter((r) => {
      const [method = "", path = ""] = r.split(" ");
      return doc.paths[path]?.[method.toLowerCase()] === undefined;
    });
    measure("G3", "coverage", {
      endpoints: ENDPOINTS.length,
      routes: routes.length,
      problems: problems.length,
      undocumented,
    });
    expect(problems).toEqual([]);
    expect(undocumented).toEqual([]);
    expect(routes.length).toBe(ENDPOINTS.length);
  });

  it("G3 the served /api/v1/openapi.json is the generated document", async () => {
    const served = await callJson(openapiGet, {}, ANON);
    const equal = JSON.stringify(served.json) === JSON.stringify(buildOpenApiDocument());
    measure("G3", "served", { status: served.status, equal });
    expect(served.status).toBe(200);
    expect(equal).toBe(true);
  });

  it("G3 negative control: a document with a broken $ref fails validation", async () => {
    const doc = buildOpenApiDocument() as Doc;
    const op = doc.paths["/api/v1/weights"]?.get;
    if (op === undefined) throw new Error("no weights operation");
    op.responses["200"] = {
      content: { "application/json": { schema: { $ref: "#/components/schemas/DoesNotExist" } } },
    };
    const v = await validity(doc);
    measure("G3", "negative-broken-ref", { valid: v.valid });
    expect(v.valid).toBe(false);
  });

  it("G3 negative control: a document missing an operation's response and an endpoint fails the coverage check", () => {
    const doc = buildOpenApiDocument() as Doc;
    const op = doc.paths["/api/v1/weights"]?.get;
    if (op === undefined) throw new Error("no weights operation");
    delete op.responses["200"];
    delete doc.paths["/api/v1/diagnostics"];
    const problems = coverageProblems(doc, ENDPOINTS);
    measure("G3", "negative-coverage", { problems });
    expect(problems).toEqual([
      "GET /api/v1/weights: no 200 response",
      "GET /api/v1/diagnostics: no operation",
    ]);
  });
});
