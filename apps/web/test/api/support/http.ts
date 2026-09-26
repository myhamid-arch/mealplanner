// A real HTTP server around the route handlers (G2): node:http → standard Request → the route
// module of the matching contract endpoint → streamed Response, so the SSE client reads a real
// socket, as a browser or the mobile app does.
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ENDPOINTS, type EndpointSpec } from "@mealplanner/api-contract/contract";
import { routeFile } from "./app";

function matcher(e: EndpointSpec): RegExp {
  const pattern = e.path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{(\w+)\\\}/g, "(?<$1>[^/]+)");
  return new RegExp(`^${pattern}$`);
}

const ROUTES = ENDPOINTS.map((e) => ({ e, re: matcher(e) }));

type Handler = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface HttpServer {
  url: string;
  close(): Promise<void>;
}

export async function startHttpServer(): Promise<HttpServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = ROUTES.map((r) => ({ ...r, m: r.re.exec(url.pathname) })).find(
        (r) => r.m !== null && r.e.method === req.method,
      );
      if (found === undefined) {
        res.writeHead(404).end();
        return;
      }
      const mod = (await import(routeFile(found.e.path))) as Record<string, Handler | undefined>;
      const handler = mod[found.e.method];
      if (handler === undefined) {
        res.writeHead(405).end();
        return;
      }
      const controller = new AbortController();
      res.on("close", () => {
        controller.abort();
      });
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const request = new Request(url, {
        method: req.method,
        headers,
        signal: controller.signal,
        ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      });
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(found.m?.groups ?? {})) params[k] = decodeURIComponent(v);
      const response = await handler(request, { params: Promise.resolve(params) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body === null) {
        res.end();
        return;
      }
      res.flushHeaders();
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>).pipe(res);
    })().catch((err: unknown) => {
      res.writeHead(500).end(String(err));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

export interface SseEvent {
  id: string | null;
  event: string | null;
  data: string;
  /** When the client received it (ms since epoch). */
  receivedAt: number;
}

/**
 * Reads an event stream until it closes, `until` returns true, or `timeoutMs` passes. Returns the
 * events and whether the server closed the stream.
 */
export async function readSse(
  url: string,
  headers: Record<string, string>,
  opts: { timeoutMs: number; until?: (e: SseEvent) => boolean },
): Promise<{ status: number; contentType: string; events: SseEvent[]; closedByServer: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs);
  const events: SseEvent[] = [];
  let closedByServer = false;
  const res = await fetch(url, { headers, signal: controller.signal });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.body === null || !res.ok) {
    clearTimeout(timer);
    return { status: res.status, contentType, events, closedByServer: true };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        closedByServer = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      let stop = false;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let id: string | null = null;
        let event: string | null = null;
        const data: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("id:")) id = line.slice(3).trim();
          else if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trim());
        }
        if (data.length === 0) continue;
        const e = { id, event, data: data.join("\n"), receivedAt: Date.now() };
        events.push(e);
        if (opts.until?.(e) === true) stop = true;
      }
      if (stop) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timer);
  }
  return { status: res.status, contentType, events, closedByServer };
}
