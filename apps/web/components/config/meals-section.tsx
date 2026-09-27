"use client";
// Meals: how a day is split across meals (UX-2 Meal split; MemberSimple, MemberDetailed,
// DetailLevels). Basic: split automatically from the slot weights (PLN-2). Detailed: tap a share
// to set it yourself; the others rebalance so the day adds up to 100 % (R2-DL-4); Back to auto.
// Expert: exact macros for a single meal (slot_target_override); the rest of the day fills around
// it (PLN-4 step 4). Overrides are the stored rows, kept whatever level is shown (R2-DL-5).
import { useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { applyChanges, problemText } from "./api";
import { attendedSlots, hhmm, levelOf, type HouseholdData, type Member, type Slot } from "./data";
import { readNumber, SaveStatus, Section } from "./parts";
import {
  AutoTag,
  DetailControl,
  TellAssistant,
  useDetailLevel,
} from "../detail-level/detail-control";
import {
  autoShares,
  inferYours,
  levelRank,
  percent,
  rebalance,
  type Level,
} from "../detail-level/logic";

const HINTS: Readonly<Record<Level, string>> = {
  basic:
    "Basic: split automatically from the household's meal weights. Your changes are kept but hidden. Detailed lets you set any meal's share.",
  detailed:
    "Detailed: tap any value to set it yourself. The others rebalance so the day still adds up to 100 %. Expert adds exact grams for a single meal.",
  expert:
    "Expert: set exact macros for a single meal (e.g. post-workout). The rest of the day fills around it.",
};

type DayKind = "default" | "training";

interface Split {
  slots: Slot[];
  auto: Record<string, number>;
  stored: Record<string, number> | null;
  yours: Set<string>;
  shares: Record<string, number>;
}

/** The split shown for a member and day kind, keyed by slot id. */
export function splitOf(data: HouseholdData, memberId: string, dayKind: DayKind): Split {
  const slots = attendedSlots(data, memberId, dayKind);
  const autoByKey = autoShares(slots.map((s) => s.key));
  const auto = Object.fromEntries(slots.map((s) => [s.id, autoByKey[s.key] ?? 0]));
  const rows = data.schedules.distributions.filter(
    (d) => d.memberId === memberId && d.dayKind === dayKind,
  );
  const covering = rows.length > 0 && slots.every((s) => rows.some((r) => r.slotTypeId === s.id));
  const stored = covering
    ? Object.fromEntries(
        slots.map((s) => [s.id, rows.find((r) => r.slotTypeId === s.id)?.share ?? 0]),
      )
    : null;
  if (stored === null) return { slots, auto, stored: null, yours: new Set(), shares: auto };
  const sum = Object.values(stored).reduce((a, b) => a + b, 0);
  const shares = Object.fromEntries(
    Object.entries(stored).map(([k, v]) => [k, sum > 0 ? v / sum : 0]),
  );
  return { slots, auto, stored, yours: inferYours(stored, auto), shares };
}

export function mealsHiddenAt(level: Level, data: HouseholdData, memberId: string): number {
  let n = 0;
  if (levelRank(level) < 1)
    for (const kind of ["default", "training"] as const)
      n += splitOf(data, memberId, kind).yours.size;
  if (levelRank(level) < 2)
    n += data.schedules.slotTargets.filter((t) => t.memberId === memberId).length;
  return n;
}

export function MealsSection({
  data,
  member,
  onChanged,
  title = "Meals",
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onChanged: () => Promise<void>;
  readonly title?: string;
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(member.id, "meal_split", levelOf(data, member.id, "meal_split"));
  const trains = data.schedules.training.some((t) => t.memberId === member.id);
  const [dayKind, setDayKind] = useState<DayKind>("default");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const split = splitOf(data, member.id, dayKind);
  const rest = data.targets.find((t) => t.memberId === member.id && t.kind === "default");
  const day =
    dayKind === "training"
      ? (data.targets.find((t) => t.memberId === member.id && t.kind === "training") ?? rest)
      : rest;

  const run = async (summary: string, ops: ChangeOp[]) => {
    try {
      await applyChanges(summary, ops);
      setError(null);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(problemText(e));
    }
  };

  const writeYours = (yours: Record<string, number>) => {
    if (Object.keys(yours).length === 0)
      return run(`Reset ${member.displayName}'s meal split to automatic`, [
        { kind: "distribution.set", payload: { memberId: member.id, dayKind, shares: null } },
      ]);
    const next = rebalance(split.auto, yours);
    return run(`Set ${member.displayName}'s meal split`, [
      {
        kind: "distribution.set",
        payload: {
          memberId: member.id,
          dayKind,
          shares: Object.entries(next).map(([slotTypeId, share]) => ({ slotTypeId, share })),
        },
      },
    ]);
  };
  const currentYours = () =>
    Object.fromEntries(
      [...split.yours].map((id) => [id, split.stored?.[id] ?? split.shares[id] ?? 0]),
    );

  const reset = async (to: Level) => {
    const ops: ChangeOp[] = [];
    if (levelRank(to) < 1)
      for (const kind of ["default", "training"] as const)
        if (
          data.schedules.distributions.some((d) => d.memberId === member.id && d.dayKind === kind)
        )
          ops.push({
            kind: "distribution.set",
            payload: { memberId: member.id, dayKind: kind, shares: null },
          });
    for (const t of data.schedules.slotTargets.filter((x) => x.memberId === member.id))
      ops.push({
        kind: "slot_target.set",
        payload: {
          memberId: member.id,
          dayKind: t.dayKind,
          slotTypeId: t.slotTypeId,
          values: null,
        },
      });
    if (ops.length > 0)
      await applyChanges(`Reset ${member.displayName}'s meal split to automatic`, ops);
    await onChanged();
  };

  const names = split.slots.map((s) => s.label.toLowerCase());
  const control = (
    <DetailControl
      scope={`${member.displayName}'s meals`}
      level={level}
      onLevel={change}
      hints={HINTS}
      hiddenAt={(l) => mealsHiddenAt(l, data, member.id)}
      onReset={reset}
      error={levelError}
    />
  );
  return (
    <Section id="meals" title={title} control={control}>
      {trains && (
        <div role="radiogroup" aria-label="Day kind" className="flex gap-1.5">
          {(["default", "training"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={dayKind === k}
              onClick={() => {
                setDayKind(k);
                setEditing(null);
              }}
              className={`min-h-11 rounded-md px-3 text-sm font-extrabold ${dayKind === k ? "bg-ink text-paper" : "bg-flour text-ink-soft"}`}
            >
              {k === "default" ? "Rest days" : "Training days"}
            </button>
          ))}
        </div>
      )}
      <p className="m-0 text-[15px]">
        {split.slots.map((s) => s.label).join(", ") || "No meals on."}
      </p>
      {levelRank(level) === 0 ? (
        <p
          className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-soft"
          data-split="basic"
        >
          Split {split.stored === null ? "automatically" : "your way"}:{" "}
          {split.slots
            .map((s, i) => `${names[i] ?? s.key} ${percent(split.shares[s.id] ?? 0)}`)
            .join(" · ")}
          <AutoTag
            state={split.yours.size > 0 ? "hidden" : "auto"}
            editable={false}
            what="meal split"
          />
        </p>
      ) : (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5"
          data-split="detailed"
        >
          {split.slots.map((slot) => {
            const share = split.shares[slot.id] ?? 0;
            const isYours = split.yours.has(slot.id);
            const override = data.schedules.slotTargets.find(
              (t) => t.memberId === member.id && t.dayKind === dayKind && t.slotTypeId === slot.id,
            );
            return (
              <div
                key={slot.id}
                data-slot={slot.key}
                className={`flex min-w-0 flex-col gap-1.5 rounded-lg border-2 p-3.5 ${isYours ? "border-action bg-tomato-tint" : "border-transparent bg-paper"}`}
              >
                <span className="font-extrabold text-ink">
                  {slot.label}{" "}
                  <span className="font-normal text-ink-soft">{hhmm(slot.defaultTime)}</span>
                </span>
                {editing === slot.id ? (
                  <form
                    className="flex flex-wrap items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const n = readNumber(draft);
                      if (n === null || !Number.isFinite(n) || n > 100) {
                        setError("Enter a percentage from 0 to 100.");
                        return;
                      }
                      setEditing(null);
                      const yours = { ...currentYours(), [slot.id]: n / 100 };
                      if (Object.values(yours).reduce((a, b) => a + b, 0) > 1) {
                        setError("Your shares add up to more than 100 %.");
                        return;
                      }
                      void writeYours(yours);
                    }}
                  >
                    <input
                      aria-label={`${slot.label} share in %`}
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                      }}
                      className="tabular min-h-11 w-16 rounded-md border-[1.5px] border-line-strong bg-card px-2 text-ink"
                    />
                    <span className="text-ink">%</span>
                    <button
                      type="submit"
                      className="min-h-11 rounded-md bg-action px-3 text-sm font-extrabold text-on-action"
                    >
                      Set
                    </button>
                  </form>
                ) : (
                  <span className="tabular text-[22px] text-ink" data-share>
                    {percent(share)}
                  </span>
                )}
                {day !== undefined && (
                  <span className="tabular text-xs text-ink-soft">
                    {Math.round(day.kcal * share)} kcal · P{Math.round(day.proteinG * share)} C
                    {Math.round(day.carbsG * share)} F{Math.round(day.fatG * share)}
                  </span>
                )}
                {editing !== slot.id && (
                  <AutoTag
                    state={isYours ? "yours" : "auto"}
                    editable
                    what={`${slot.label} share`}
                    onEdit={() => {
                      setDraft(String(Math.round(share * 100)));
                      setEditing(slot.id);
                    }}
                    onBackToAuto={() => {
                      void writeYours(
                        Object.fromEntries(
                          Object.entries(currentYours()).filter(([k]) => k !== slot.id),
                        ),
                      );
                    }}
                  />
                )}
                {levelRank(level) === 2 && (
                  <ExactMeal
                    member={member}
                    slot={slot}
                    dayKind={dayKind}
                    values={override ?? null}
                    onSave={run}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {split.slots.length > 0 && levelRank(level) >= 1 && (
        <p className="m-0 text-xs text-ink-soft">
          Total {percent(split.slots.reduce((a, s) => a + (split.shares[s.id] ?? 0), 0))}. On days a
          meal is skipped the others share its part.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <TellAssistant prompt={`Change how ${member.displayName}'s day is split across meals: `} />
      </div>
    </Section>
  );
}

function ExactMeal({
  member,
  slot,
  dayKind,
  values,
  onSave,
}: {
  readonly member: Member;
  readonly slot: Slot;
  readonly dayKind: DayKind;
  readonly values: {
    kcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
  } | null;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    proteinG: values?.proteinG?.toString() ?? "",
    carbsG: values?.carbsG?.toString() ?? "",
    fatG: values?.fatG?.toString() ?? "",
    kcal: values?.kcal?.toString() ?? "",
  });
  const summary =
    values === null
      ? null
      : (["kcal", "proteinG", "carbsG", "fatG"] as const)
          .filter((k) => values[k] !== null)
          .map((k) => `${k === "kcal" ? "kcal" : (k[0]?.toUpperCase() ?? "")} ${String(values[k])}`)
          .join(" · ");
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {summary !== null && <span className="tabular text-xs text-ink">{summary}</span>}
        {values === null ? (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
            }}
            className="min-h-11 text-left text-xs font-extrabold text-ink underline"
          >
            Set exact macros
          </button>
        ) : (
          <>
            <AutoTag
              state="yours"
              editable
              what={`${slot.label} exact macros`}
              onBackToAuto={() =>
                void onSave(`Clear ${member.displayName}'s ${slot.label} macros`, [
                  {
                    kind: "slot_target.set",
                    payload: { memberId: member.id, dayKind, slotTypeId: slot.id, values: null },
                  },
                ])
              }
            />
            <button
              type="button"
              onClick={() => {
                setOpen(true);
              }}
              className="min-h-11 text-xs font-extrabold text-ink underline"
            >
              Edit
            </button>
          </>
        )}
      </div>
    );
  return (
    <form
      aria-label={`${slot.label} exact macros`}
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const read = (s: string) => {
          const n = readNumber(s);
          return n !== null && Number.isFinite(n) ? n : null;
        };
        const v = {
          kcal: read(draft.kcal),
          proteinG: read(draft.proteinG),
          carbsG: read(draft.carbsG),
          fatG: read(draft.fatG),
        };
        if (Object.values(v).every((x) => x === null)) return;
        setOpen(false);
        void onSave(`Set ${member.displayName}'s ${slot.label} macros`, [
          {
            kind: "slot_target.set",
            payload: { memberId: member.id, dayKind, slotTypeId: slot.id, values: v },
          },
        ]);
      }}
    >
      {(["proteinG", "carbsG", "fatG", "kcal"] as const).map((k) => (
        <label
          key={k}
          className="flex items-center justify-between gap-2 text-xs font-extrabold text-ink"
        >
          {k === "kcal" ? "kcal" : `${k[0]?.toUpperCase() ?? ""} g`}
          <input
            inputMode="numeric"
            value={draft[k]}
            onChange={(e) => {
              setDraft({ ...draft, [k]: e.target.value });
            }}
            className="tabular min-h-11 w-20 rounded-md border-[1.5px] border-line-strong bg-card px-2"
          />
        </label>
      ))}
      <button
        type="submit"
        className="min-h-11 rounded-md bg-action px-3 text-sm font-extrabold text-on-action"
      >
        Save
      </button>
    </form>
  );
}
