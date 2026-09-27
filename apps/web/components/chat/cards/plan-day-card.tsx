"use client";

import Link from "next/link";
import { useChatData } from "../context";
import { dayTitle } from "../../reviews/targets";
import { FitBadge } from "./fit";
import type { PlanDayCard as Card } from "./parse";

/** The Monday of `date`'s week (the plan screen's `?week=`). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** AGT-7 `plan_day`: a compact day view with per-member fit badges. */
export function PlanDayCardView({ card }: { readonly card: Card }) {
  const { names } = useChatData();
  const meals = [...card.meals].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-card" data-card="plan_day">
      <div className="flex items-center gap-2">
        <span className="font-extrabold">{dayTitle(card.date)}</span>
        <Link href={`/plan?week=${mondayOf(card.date)}`} className="ml-auto text-sm font-extrabold">
          Open the plan
        </Link>
      </div>
      {meals.length === 0 ? (
        <span className="text-sm text-ink-soft">Nothing planned for this day.</span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {meals.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0"
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-extrabold text-ink-soft">
                  {m.slotLabel} · {m.kind === "shared" ? "SHARED" : "INDIVIDUAL"}
                </span>
                <span className="font-bold">{m.dishName}</span>
              </span>
              {m.plates.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {m.plates.map((p) => (
                    <FitBadge
                      key={p.id}
                      status={p.fitStatus}
                      who={names.get(p.memberId) ?? "Someone"}
                    />
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
