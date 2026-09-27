"use client";
// Client data access for the Today, Plan, Plate and Kitchen screens (and the recipe screens):
// the typed client from @mealplanner/api-contract (ARC-5), same origin with the session cookie
// (leaf-1.4.4 ADR-2). Response types come from the contract; nothing re-declares a DTO.
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { ApiProblem, createApiClient } from "@mealplanner/api-contract/client";
import * as c from "@mealplanner/api-contract/contract";
import type { ChangeOp } from "@mealplanner/core/changes";
import type { Json as JsonValue } from "@mealplanner/core/types";

export const api = createApiClient({ baseUrl: "" });
export { c };

export type Me = z.output<typeof c.MeDto>;
export type Member = z.output<typeof c.MemberDto>;
export type Slot = z.output<typeof c.SlotDto>;
export type Targets = z.output<typeof c.TargetsDto>;
export type TargetProfile = z.output<typeof c.TargetProfileDto>;
export type Tolerance = z.output<typeof c.ToleranceDto>;
export type Household = z.output<typeof c.HouseholdDto>;
export type PlanDay = z.output<typeof c.PlanDayDto>;
export type PlanMeal = z.output<typeof c.PlanMealDto>;
export type Plate = z.output<typeof c.PlateDto>;
export type Nutrients = z.output<typeof c.Nutrients>;
export type ScoreBreakdown = z.output<typeof c.ScoreBreakdownDto>;
export type Alternatives = z.output<typeof c.AlternativesDto>;
export type CookSheet = z.output<typeof c.CookSheetDto>;
export type CookSheetMeal = CookSheet["meals"][number];
export type KitchenFlagView = z.output<typeof c.KitchenFlagViewDto>;
export type DishSummary = z.output<typeof c.DishSummaryDto>;
export type Dish = z.output<typeof c.DishDto>;
export type Component = Dish["components"][number];
export type Variant = Component["variants"][number];
export type Cuisine = z.output<typeof c.CuisineDto>;
export type Ingredient = z.output<typeof c.IngredientDto>;
export type Review = z.output<typeof c.ReviewDto>;
export type Schedules = z.output<typeof c.SchedulesDto>;
export type MealOverride = z.output<typeof c.MealOverrideDto>;
export type Proposal = z.output<typeof c.ProposalDto>;
export type Role = Me["memberships"][number]["role"];

/** A plain-language message for a failed call (UX-7). */
export function problemText(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.problem.status === 401) return "Your session has ended. Sign in again.";
    if (error.problem.status === 403) return "Only an admin of this household can do that.";
    return error.problem.detail ?? error.problem.title;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Loads with `load` when `key` changes and on `reload()`; keeps the last data while reloading. */
export function useLoad<T>(load: () => Promise<T>, key = ""): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const serial = useRef(0);
  const reload = useCallback(async () => {
    serial.current += 1;
    const mine = serial.current;
    setLoading(true);
    try {
      const value = await loader.current();
      if (mine !== serial.current) return;
      setData(value);
      setError(null);
    } catch (e) {
      if (mine !== serial.current) return;
      setError(problemText(e));
    } finally {
      if (mine === serial.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, key]);
  return { data, error, loading, reload };
}

/** Applies ops as one change set (DM-6); returns the change-set id. */
export async function applyChanges(summary: string, ops: readonly ChangeOp[]): Promise<string> {
  const res = await api.call(c.changeSetsApply, {
    body: { summary: summary.slice(0, 200), ops: [...ops] as unknown as JsonValue[] },
  });
  return res.changeSetId;
}

export interface JobState {
  status: "idle" | "running" | "done" | "failed";
  /** The latest progress line, e.g. "Planning Wednesday". */
  progress: string | null;
  error: string | null;
}

/** Job and planner progress events (worker runner; core PlanProgress). */
const PROGRESS: Record<string, string> = {
  started: "Started",
  retrying: "Trying again",
  day_started: "Planning",
  meal_planned: "Planned",
  ai_generating: "Writing new recipes for",
  improvement_pass: "Looking for better swaps",
  retargeting: "Balancing the day",
  planned: "Saving the plan",
};

function progressLine(type: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const date = typeof p.date === "string" ? ` ${p.date}` : "";
  const slot = typeof p.slotKey === "string" ? ` ${p.slotKey.replaceAll("_", " ")}` : "";
  return `${PROGRESS[type] ?? type.replaceAll("_", " ")}${date}${slot}`;
}

/**
 * Follows a job until it ends: Server-Sent Events from `/jobs/{id}/events` (admin), falling back
 * to polling `GET /jobs/{id}` when the stream cannot be opened. Resolves with the final state.
 */
export function followJob(jobId: string, onProgress: (line: string) => void): Promise<JobState> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (s: JobState) => {
      if (settled) return;
      settled = true;
      resolve(s);
    };
    const poll = async () => {
      for (let i = 0; i < 600 && !settled; i += 1) {
        try {
          const job = await api.call(c.jobsGet, { params: { id: jobId } });
          if (job.status === "succeeded") {
            finish({ status: "done", progress: null, error: null });
            return;
          }
          if (job.status === "failed" || job.status === "cancelled") {
            finish({
              status: "failed",
              progress: null,
              error: "The planner could not finish. Try again.",
            });
            return;
          }
        } catch (e) {
          finish({ status: "failed", progress: null, error: problemText(e) });
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      finish({ status: "failed", progress: null, error: "The planner is taking too long." });
    };
    if (typeof EventSource === "undefined") {
      void poll();
      return;
    }
    const source = new EventSource(`/api/v1/jobs/${jobId}/events`);
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const e = JSON.parse(event.data) as { type: string; payload: unknown };
        if (e.type === "done") {
          source.close();
          finish({ status: "done", progress: null, error: null });
        } else if (e.type === "failed") {
          source.close();
          finish({
            status: "failed",
            progress: null,
            error: "The planner could not finish. Try again.",
          });
        } else onProgress(progressLine(e.type, e.payload));
      } catch {
        // A malformed event is skipped; the terminal event still ends the stream.
      }
    };
    for (const type of ["done", "failed", ...Object.keys(PROGRESS)])
      source.addEventListener(type, (event) => {
        source.onmessage?.(event as MessageEvent<string>);
      });
    source.onerror = () => {
      source.close();
      void poll();
    };
  });
}
