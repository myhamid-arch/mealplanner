// The web runtime for one test database, with a capturing mailer (test-only port implementation,
// ADR-4), and direct invocation of the real route handlers with standard Requests (ADR-3).
import { fillPath, type EndpointSpec } from "@mealplanner/api-contract/contract";
import type { Mailer, MailMessage } from "../../../lib/server/mail";
import { createRuntime, randomSecret, useRuntime, type Runtime } from "../../../lib/server/runtime";

export const APP_URL = "http://app.test";

export interface TestApp {
  rt: Runtime;
  mail: MailMessage[];
  close(): Promise<void>;
}

export function capturingMailer(box: MailMessage[]): Mailer {
  return {
    configured: true,
    send(message) {
      box.push(message);
      return Promise.resolve();
    },
  };
}

export function startTestApp(databaseUrl: string, opts: { mailer?: Mailer } = {}): TestApp {
  const mail: MailMessage[] = [];
  const rt = createRuntime({
    databaseUrl,
    secret: randomSecret(),
    mailer: opts.mailer ?? capturingMailer(mail),
    config: { appUrl: APP_URL, chatTurnsPerHour: 30, aiRecipeDailyLimit: 60 },
  });
  useRuntime(rt);
  return {
    rt,
    mail,
    async close() {
      useRuntime(undefined);
      await rt.close();
    },
  };
}

/** The route module file of an endpoint (`/api/v1/plan-meals/{id}` → app/api/v1/plan-meals/[id]). */
export function routeFile(path: string): string {
  return `../../../app${path.replace(/\{([a-zA-Z]+)\}/g, "[$1]")}/route.ts`;
}

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const modules = new Map<string, Record<string, unknown>>();

async function handlerOf(endpoint: EndpointSpec): Promise<Handler> {
  const file = routeFile(endpoint.path);
  let mod = modules.get(file);
  if (mod === undefined) {
    mod = (await import(file)) as Record<string, unknown>;
    modules.set(file, mod);
  }
  const handler = mod[endpoint.method];
  if (typeof handler !== "function") throw new Error(`${file} has no ${endpoint.method} export`);
  return handler as Handler;
}

export interface CallInput {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Raw body text (invalid JSON tests). */
  rawBody?: string;
}

export interface Caller {
  /** Bearer token of the caller's session (null: anonymous). */
  token: string | null;
  householdId?: string;
}

export const ANON: Caller = { token: null };

export function requestFor(
  endpoint: EndpointSpec,
  input: CallInput,
  caller: Caller,
  headers: Record<string, string> = {},
): Request {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) if (v !== undefined) qs.set(k, String(v));
  const q = qs.toString();
  const url = `${APP_URL}${fillPath(endpoint.path, input.params ?? {})}${q === "" ? "" : `?${q}`}`;
  const h = new Headers(headers);
  if (caller.token !== null) h.set("authorization", `Bearer ${caller.token}`);
  if (caller.householdId !== undefined && !h.has("x-household-id"))
    h.set("x-household-id", caller.householdId);
  let body: string | undefined;
  if (input.rawBody !== undefined) body = input.rawBody;
  else if (input.body !== undefined) body = JSON.stringify(input.body);
  if (body !== undefined) h.set("content-type", "application/json");
  return new Request(url, {
    method: endpoint.method,
    headers: h,
    ...(body === undefined ? {} : { body }),
  });
}

/** Calls the real route handler of `endpoint`. */
export async function call(
  endpoint: EndpointSpec,
  input: CallInput,
  caller: Caller,
  headers?: Record<string, string>,
): Promise<Response> {
  const handler = await handlerOf(endpoint);
  return handler(requestFor(endpoint, input, caller, headers), {
    params: Promise.resolve(input.params ?? {}),
  });
}

/** Calls and returns status and parsed JSON (or text). */
export async function callJson(
  endpoint: EndpointSpec,
  input: CallInput,
  caller: Caller,
  headers?: Record<string, string>,
) {
  const res = await call(endpoint, input, caller, headers);
  const text = await res.text();
  let json: unknown;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers, text };
}

/** Better Auth's own endpoints (/api/auth/*) through the real catch-all route. */
export async function authCall(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  const mod = (await import("../../../app/api/auth/[...all]/route")) as {
    POST: (r: Request) => Promise<Response>;
  };
  return mod.POST(
    new Request(`${APP_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_URL, ...headers },
      body: JSON.stringify(body),
    }),
  );
}
