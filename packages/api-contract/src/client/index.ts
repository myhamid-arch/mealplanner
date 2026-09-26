// @mealplanner/api-contract/client: the typed fetch client used by the web client code and the
// mobile app (ARC-5: one contract). Responses are parsed with the contract's schemas; errors are
// thrown as `ApiProblem` (RFC 7807).
import {
  Problem,
  type EndpointSpec,
  type Input,
  type Output,
  fillPath,
} from "../contract/index.js";

export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(`${String(problem.status)} ${problem.code}: ${problem.detail ?? problem.title}`);
    this.name = "ApiProblem";
  }
  get status(): number {
    return this.problem.status;
  }
  get code(): string {
    return this.problem.code;
  }
}

export interface ApiClientOptions {
  /** Origin, e.g. `https://app.example` ("" for same-origin browser use). */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Extra headers for every request (e.g. `Authorization: Bearer …`, `X-Household-Id`). */
  headers?: Record<string, string>;
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (query === undefined) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      params.set(key, String(value));
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

async function problemOf(res: Response): Promise<ApiProblem> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const parsed = Problem.safeParse(body);
  return new ApiProblem(
    parsed.success
      ? parsed.data
      : {
          type: "about:blank",
          title: res.statusText,
          status: res.status,
          code: "http_error",
          detail: text.slice(0, 500),
        },
  );
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? fetch;
  async function raw<S extends EndpointSpec>(
    endpoint: S,
    input: Input<S>,
    init: RequestInit = {},
  ): Promise<Response> {
    const i = input as {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    const url = `${options.baseUrl}${fillPath(endpoint.path, i.params)}${queryString(i.query)}`;
    const res = await doFetch(url, {
      ...init,
      method: endpoint.method,
      credentials: "include",
      headers: {
        ...(i.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
        ...(init.headers as Record<string, string> | undefined),
      },
      ...(i.body === undefined ? {} : { body: JSON.stringify(i.body) }),
    });
    if (!res.ok) throw await problemOf(res);
    return res;
  }

  /** Calls a JSON endpoint and returns its parsed response. */
  async function call<S extends EndpointSpec>(endpoint: S, input: Input<S>): Promise<Output<S>> {
    const res = await raw(endpoint, input);
    if (res.status === 204 || endpoint.response === undefined) return undefined as Output<S>;
    if (endpoint.format === "csv") return (await res.text()) as Output<S>;
    return endpoint.response.parse(await res.json()) as Output<S>;
  }

  /** Reads an SSE endpoint as parsed events; `lastEventId` resumes after that event. */
  async function* events<S extends EndpointSpec>(
    endpoint: S,
    input: Input<S>,
    opts: { lastEventId?: string; signal?: AbortSignal } = {},
  ): AsyncGenerator<Output<S>> {
    const res = await raw(endpoint, input, {
      headers: {
        accept: "text/event-stream",
        ...(opts.lastEventId === undefined ? {} : { "last-event-id": opts.lastEventId }),
      },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    if (res.body === null) return;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data !== "" && endpoint.response !== undefined)
          yield endpoint.response.parse(JSON.parse(data)) as Output<S>;
        end = buffer.indexOf("\n\n");
      }
    }
  }

  return { call, events, raw };
}

export type ApiClient = ReturnType<typeof createApiClient>;
