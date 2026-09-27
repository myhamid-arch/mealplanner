"use client";

import { useEffect, useState } from "react";
import { jobsEvents } from "@mealplanner/api-contract/contract";
import { api } from "../../admin/api";
import { useChatData } from "../context";
import { dayTitle } from "../../reviews/targets";
import type { JobProgressCard as Card } from "./parse";

const KINDS: Readonly<Record<string, string>> = {
  "plan.generate": "Planning",
  "insights.run": "Looking through the reviews",
  "recipe.draft": "Writing recipe ideas",
};

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/**
 * AGT-7 `job_progress`: a live progress bar for a plan, insights or recipe job. While the job is
 * queued or running it follows `GET /jobs/{id}/events`; when it ends, the conversation is re-read
 * so the worker's completion message appears (R-46).
 */
export function JobProgressCardView({ card }: { readonly card: Card }) {
  const { onJobDone } = useChatData();
  const [status, setStatus] = useState<string>(card.status);
  const [detail, setDetail] = useState<string | null>(null);
  const [meals, setMeals] = useState(0);
  const open = status === "queued" || status === "running";

  useEffect(() => {
    if (card.status !== "queued" && card.status !== "running") return;
    const abort = new AbortController();
    void (async () => {
      try {
        for await (const e of api.events(
          jobsEvents,
          { params: { id: card.jobId } },
          { signal: abort.signal },
        )) {
          if (e.type === "started") setStatus("running");
          const p = (typeof e.payload === "object" && e.payload !== null ? e.payload : {}) as {
            date?: unknown;
          };
          // Plan jobs (PLN progress): the day being planned and the meals chosen so far.
          if (e.type === "day_started" && typeof p.date === "string")
            setDetail(`Planning ${dayTitle(p.date)}`);
          if (e.type === "meal_planned") setMeals((n) => n + 1);
          if (e.type === "improvement_pass") setDetail("Trying better swaps");
          if (e.type === "retargeting") setDetail("Balancing the day's totals");
          if (e.type === "ai_generating") setDetail("Writing a new recipe for a gap");
          if (e.type === "retrying") setDetail("Retrying after a hiccup");
          if (TERMINAL.has(e.type)) {
            setStatus(e.type === "done" ? "succeeded" : e.type);
            onJobDone(card.jobId);
            return;
          }
        }
      } catch {
        // The stream ended (navigation or network); the stored state is shown.
      }
    })();
    return () => {
      abort.abort();
    };
  }, [card.jobId, card.status, onJobDone]);

  const label = KINDS[card.kind] ?? card.kind;
  const statusText =
    status === "queued"
      ? "Waiting to start"
      : status === "running"
        ? `${detail ?? "Working on it"}${meals > 0 ? ` · ${String(meals)} ${meals === 1 ? "meal" : "meals"} chosen` : ""}`
        : status === "succeeded"
          ? "Finished"
          : status === "failed"
            ? `Did not finish${card.error === undefined ? "" : `: ${card.error}`}`
            : "Cancelled";
  return (
    <div
      className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card"
      data-card="job_progress"
    >
      <div className="flex items-center gap-2">
        <span className="font-extrabold">{label}</span>
        <span className="ml-auto text-[13px] font-bold text-ink-soft" role="status">
          {statusText}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={statusText}
        {...(open ? {} : { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 100 })}
        className="h-2.5 overflow-hidden rounded-full bg-flour"
      >
        <div
          className={`h-full rounded-full ${
            status === "failed" || status === "cancelled"
              ? "w-full bg-pomegranate"
              : open
                ? "w-1/3 bg-agent motion-safe:animate-pulse"
                : "w-full bg-basil"
          }`}
        />
      </div>
    </div>
  );
}
