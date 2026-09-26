// @mealplanner/api-contract/openapi: the OpenAPI 3.1 document of ENDPOINTS (ARC-5), generated from
// the contract's Zod schemas with Zod's JSON Schema output (draft 2020-12, OpenAPI 3.1's dialect).
import { z } from "zod";
import { Problem } from "../contract/common.js";
import { ENDPOINTS, type EndpointSpec, pathParams } from "../contract/index.js";

export const OPENAPI_VERSION = "3.1.1";

type JsonObject = Record<string, unknown>;

/** Shared definitions hoisted from each schema's `$defs` into `components.schemas`. */
let components: Record<string, unknown> = {};

/**
 * A schema as OpenAPI 3.1 JSON Schema. Recursive schemas (e.g. `z.json()`) come with local `$defs`;
 * OpenAPI resolves `$ref`s against the document root, so those definitions move to
 * `components.schemas` (content-addressed names, so identical definitions are shared).
 */
function schemaOf(schema: z.ZodType, io: "input" | "output"): JsonObject {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "any",
  }) as JsonObject;
  delete json.$schema;
  const defs = (json.$defs ?? {}) as Record<string, unknown>;
  delete json.$defs;
  const names = new Map<string, string>();
  for (const [name, def] of Object.entries(defs)) {
    const hoisted = `Def${hash(JSON.stringify(def))}`;
    names.set(`#/$defs/${name}`, `#/components/schemas/${hoisted}`);
  }
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value))
        out[k] = k === "$ref" && typeof v === "string" ? (names.get(v) ?? v) : rewrite(v);
      return out;
    }
    return value;
  };
  for (const [name, def] of Object.entries(defs)) {
    const target = names.get(`#/$defs/${name}`)?.slice("#/components/schemas/".length);
    if (target !== undefined) components[target] = rewrite(def);
  }
  return rewrite(json) as JsonObject;
}

/** FNV-1a, 32-bit, hex: stable short names for hoisted definitions. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Invalid request (problem+json with issues)",
  401: "Not signed in, or the session was revoked",
  403: "Not allowed for this role, suspended household, TOTP required, or no support grant",
  404: "Not found in this household",
  409: "Conflict",
  410: "Gone (invite used, revoked or expired)",
  422: "The change was refused by a domain rule",
  429: "Rate limited",
  500: "Server error",
  503: "Service not configured (e.g. email)",
};

function problemResponse(status: number): JsonObject {
  return {
    description: STATUS_TEXT[status] ?? "Error",
    content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
  };
}

function operation(e: EndpointSpec): JsonObject {
  const parameters: JsonObject[] = [];
  const params = e.params?.shape ?? {};
  for (const name of pathParams(e.path)) {
    const schema = params[name] as z.ZodType | undefined;
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: schema === undefined ? { type: "string" } : schemaOf(schema, "input"),
    });
  }
  for (const [name, schema] of Object.entries(e.query?.shape ?? {})) {
    const s = schema as z.ZodType;
    parameters.push({
      name,
      in: "query",
      required: !s.safeParse(undefined).success,
      schema: schemaOf(s, "input"),
    });
  }
  if (e.auth === "household")
    parameters.push({
      name: "X-Household-Id",
      in: "header",
      required: false,
      description: "The household to act on; required when the user belongs to several.",
      schema: { type: "string", format: "uuid" },
    });
  const status = e.status ?? 200;
  let success: JsonObject;
  if (status === 204) success = { description: STATUS_TEXT[204] };
  else if (e.format === "csv")
    success = { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } };
  else if (e.format === "sse")
    success = {
      description: "Server-Sent Events; each `data:` line is one item of this schema",
      content: {
        "text/event-stream": {
          schema: e.response === undefined ? { type: "string" } : schemaOf(e.response, "output"),
        },
      },
    };
  else
    success = {
      description: STATUS_TEXT[status] ?? "OK",
      content: {
        "application/json": {
          schema: e.response === undefined ? {} : schemaOf(e.response, "output"),
        },
      },
    };
  const errors = new Set<number>([400, 500, ...(e.errors ?? [])]);
  if (e.auth !== "public") errors.add(401);
  if (e.auth === "household" || e.auth === "operator") {
    errors.add(403);
    errors.add(404);
  }
  if (e.params !== undefined) errors.add(404);
  const responses: JsonObject = { [String(status)]: success };
  for (const code of [...errors].sort((a, b) => a - b))
    responses[String(code)] = problemResponse(code);
  const op: JsonObject = {
    operationId: e.id,
    summary: e.summary,
    tags: [e.tag],
    parameters,
    responses,
    security:
      e.auth === "public"
        ? []
        : e.auth === "optional"
          ? [{}, { cookie: [] }, { bearer: [] }]
          : [{ cookie: [] }, { bearer: [] }],
    "x-roles": e.auth === "household" ? [...(e.roles ?? [])] : [e.auth],
  };
  if (e.body !== undefined)
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: schemaOf(e.body, "input") } },
    };
  return op;
}

/** The OpenAPI document of every endpoint. */
export function buildOpenApiDocument(endpoints: readonly EndpointSpec[] = ENDPOINTS): JsonObject {
  components = {};
  const problem = schemaOf(Problem, "output");
  const paths: Record<string, JsonObject> = {};
  for (const e of endpoints) {
    const item = paths[e.path] ?? {};
    item[e.method.toLowerCase()] = operation(e);
    paths[e.path] = item;
  }
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Family Meal Planner API",
      version: "1.0.0",
      description:
        "REST JSON API (ARC-5). Errors are RFC 7807 problem+json. Every household endpoint enforces the ARC-6 role matrix (`x-roles`) and household scope.",
    },
    servers: [{ url: "/" }],
    tags: [...new Set(endpoints.map((e) => e.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas: { Problem: problem, ...components },
      securitySchemes: {
        cookie: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        bearer: { type: "http", scheme: "bearer" },
      },
    },
  };
}
