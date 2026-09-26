// ARC-12 structured logs (pino; BLD-8 R-40): job id, kind, household id, durations and planner
// metrics. Level from LOG_LEVEL (default `info`).
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "worker" },
});

export type Logger = typeof logger;
