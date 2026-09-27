"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { z } from "zod";
import { diagnosticsGet, type DiagnosticsDto } from "@mealplanner/api-contract/contract";
import { api } from "../../../../components/admin/api";
import { fullTime, logTime, thousands } from "../../../../components/admin/format";
import { LoadError } from "../../../../components/admin/load-error";
import { useLoad } from "../../../../components/admin/use-load";
import { Chip } from "../../../../components/ui/chip";
import { Icon } from "../../../../components/ui/icon";
import { SkeletonBlock } from "../../../../components/ui/skeleton";

type Diagnostics = z.output<typeof DiagnosticsDto>;

const PURPOSE: Readonly<Record<string, string>> = {
  recipe: "Recipe",
  insights: "Insights",
  chat: "Assistant",
  comment_extraction: "Review tags",
};

/** Stop reasons that mean the call did not end normally (REC/AGT: `stop_reason` is checked). */
const TROUBLE = new Set(["max_tokens", "refusal", "pause_turn", "error"]);

function errorText(error: unknown): string {
  if (error === null || error === undefined) return "No reason recorded";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return JSON.stringify(error);
}

const TH =
  "px-3 py-2.5 text-left text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase";
const TD = "px-3 py-2.5 align-top";

function Table({
  caption,
  head,
  children,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-[20px] bg-card shadow-card">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-flour">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DiagnosticsScreen() {
  const load = useLoad<Diagnostics>(() => api.call(diagnosticsGet, {}));
  return (
    <div className="flex flex-col gap-5">
      <Link href="/account" className="flex min-h-11 w-fit items-center gap-1 font-extrabold">
        <Icon name="chevronLeft" size={18} />
        My account
      </Link>
      <div>
        <h1 className="text-[28px] lg:text-[34px]">Diagnostics</h1>
        <p className="m-0 mt-1 text-ink-soft">
          The last 50 AI calls and the jobs that failed, for troubleshooting.
        </p>
      </div>
      {load.status === "loading" ? (
        <SkeletonBlock label="Loading diagnostics" lines={6} />
      ) : load.status === "error" ? (
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      ) : (
        <>
          <section aria-labelledby="ai-calls" className="flex flex-col gap-3">
            <h2 id="ai-calls" className="text-[22px]">
              AI calls
            </h2>
            {load.data.aiCalls.length === 0 ? (
              <p className="m-0 text-ink-soft">No AI calls yet.</p>
            ) : (
              <Table
                caption="The last 50 AI calls"
                head={["When", "For", "Model", "Input", "Output", "Cache hits", "Stop reason"]}
              >
                {load.data.aiCalls.map((c) => (
                  <tr key={c.id} className="border-t border-flour">
                    <td className={TD}>
                      <time dateTime={c.createdAt} title={fullTime(c.createdAt)}>
                        {logTime(c.createdAt)}
                      </time>
                    </td>
                    <td className={TD}>{PURPOSE[c.purpose] ?? c.purpose}</td>
                    <td className={`${TD} font-mono`}>{c.model}</td>
                    <td className={`${TD} tabular`}>{thousands(c.inputTokens)}</td>
                    <td className={`${TD} tabular`}>{thousands(c.outputTokens)}</td>
                    <td className={`${TD} tabular`}>{thousands(c.cacheReadTokens)}</td>
                    <td className={TD}>
                      <span className="flex flex-wrap gap-1.5">
                        <Chip
                          size="sm"
                          tone={TROUBLE.has(c.stopReason) ? "saffron" : "neutral"}
                          {...(TROUBLE.has(c.stopReason) ? { icon: "approx" as const } : {})}
                        >
                          {c.stopReason}
                        </Chip>
                        {c.hasValidationErrors && (
                          <Chip size="sm" tone="pomegranate" icon="cross">
                            failed validation
                          </Chip>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
          <section aria-labelledby="failed-jobs" className="flex flex-col gap-3">
            <h2 id="failed-jobs" className="text-[22px]">
              Failed jobs
            </h2>
            {load.data.failedJobs.length === 0 ? (
              <p className="m-0 text-ink-soft">No failed jobs.</p>
            ) : (
              <Table caption="Failed jobs" head={["Failed", "Job", "Reason", "Started"]}>
                {load.data.failedJobs.map((j) => (
                  <tr key={j.id} className="border-t border-flour">
                    <td className={TD}>
                      {j.finishedAt === null ? (
                        "—"
                      ) : (
                        <time dateTime={j.finishedAt} title={fullTime(j.finishedAt)}>
                          {logTime(j.finishedAt)}
                        </time>
                      )}
                    </td>
                    <td className={`${TD} font-mono`}>{j.kind}</td>
                    <td className={`${TD} max-w-[420px] break-words`}>{errorText(j.error)}</td>
                    <td className={TD}>
                      {j.startedAt === null ? "Never started" : logTime(j.startedAt)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
