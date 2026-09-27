"use client";
// Training (PRD-7; MemberSimple, MemberDetailed): the weekly training days with time and
// intensity. A training day adds the pre- and post-workout meals and, when set, the training-day
// targets (PLN-4 step 1). One-off changes live on the week plan (day_override, 1.4.4).
import { useState } from "react";
import { WEEKDAY_SHORT } from "@mealplanner/core/onboarding";
import { applyChanges, problemText } from "./api";
import { hhmm, type HouseholdData, type Member } from "./data";
import { SaveStatus, Section } from "./parts";
import { TellAssistant } from "../detail-level/detail-control";

type Intensity = "light" | "moderate" | "hard";
interface Day {
  weekday: number;
  sessionTime: string | null;
  intensity: Intensity | null;
}

export function TrainingSection({
  data,
  member,
  onChanged,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onChanged: () => Promise<void>;
}) {
  const stored: Day[] = data.schedules.training
    .filter((t) => t.memberId === member.id)
    .map((t) => ({ weekday: t.weekday, sessionTime: t.sessionTime, intensity: t.intensity }));
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState<Day[]>(stored);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    try {
      await applyChanges(`Set ${member.displayName}'s training days`, [
        {
          kind: "training.set",
          payload: { memberId: member.id, days: [...days].sort((a, b) => a.weekday - b.weekday) },
        },
      ]);
      setEditing(false);
      setError(null);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(problemText(e));
    }
  };
  const shown = editing ? days : stored;
  const control = editing ? undefined : (
    <button
      type="button"
      onClick={() => {
        setDays(stored);
        setEditing(true);
      }}
      className="min-h-11 text-sm font-extrabold text-action underline"
    >
      {stored.length === 0 ? "Add training days" : "Change training days"}
    </button>
  );
  return (
    <Section id="training" title="Training" control={control}>
      {!editing && stored.length === 0 ? (
        <p className="m-0 text-sm text-ink-soft">
          None yet. Training days add pre- and post-workout meals.
        </p>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-soft">One-off change? Tap a day in the week plan.</p>
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAY_SHORT.map((label, weekday) => {
              const day = shown.find((d) => d.weekday === weekday);
              const on = day !== undefined;
              return (
                <li
                  key={label}
                  data-training-day={label}
                  className={`flex min-w-0 flex-col gap-1 rounded-lg p-3 ${on ? "bg-ink text-paper" : "bg-flour text-ink"}`}
                >
                  {editing ? (
                    <>
                      <label className="flex items-center gap-2 font-extrabold">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setDays(
                              on
                                ? days.filter((d) => d.weekday !== weekday)
                                : [...days, { weekday, sessionTime: "18:00:00", intensity: null }],
                            );
                          }}
                          className="size-5"
                        />
                        {label}
                      </label>
                      {on && (
                        <>
                          <input
                            type="time"
                            aria-label={`${label} session time`}
                            value={day.sessionTime === null ? "" : hhmm(day.sessionTime)}
                            onChange={(e) => {
                              setDays(
                                days.map((d) =>
                                  d.weekday === weekday
                                    ? {
                                        ...d,
                                        sessionTime:
                                          e.target.value === "" ? null : `${e.target.value}:00`,
                                      }
                                    : d,
                                ),
                              );
                            }}
                            className="min-h-11 rounded-md bg-card px-2 text-ink"
                          />
                          <select
                            aria-label={`${label} intensity`}
                            value={day.intensity ?? ""}
                            onChange={(e) => {
                              setDays(
                                days.map((d) =>
                                  d.weekday === weekday
                                    ? {
                                        ...d,
                                        intensity:
                                          e.target.value === ""
                                            ? null
                                            : (e.target.value as Intensity),
                                      }
                                    : d,
                                ),
                              );
                            }}
                            className="min-h-11 rounded-md bg-card px-1 text-ink"
                          >
                            <option value="">Intensity</option>
                            <option value="light">light</option>
                            <option value="moderate">moderate</option>
                            <option value="hard">hard</option>
                          </select>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="font-extrabold">{label}</span>
                      <span className="text-[13px]">
                        {on
                          ? [day.sessionTime === null ? null : hhmm(day.sessionTime), day.intensity]
                              .filter((x) => x !== null)
                              .join(" · ") || "Training"
                          : "Rest"}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {editing && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
          >
            Save training days
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
            }}
            className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <TellAssistant prompt={`${member.displayName} trains on `} />
      </div>
    </Section>
  );
}
