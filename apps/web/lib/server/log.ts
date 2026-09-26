// ARC-12 structured logs (pino; BLD-8 R-40): every line carries the request id and, once known, the
// household id. Level from LOG_LEVEL (default `info`; `silent` in tests).
import pino, { type Logger } from "pino";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "web" },
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
});

export type { Logger };
