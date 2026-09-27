"use client";
// Meals & schedule (ScheduleGrid.dc.html; UX-2 Slots; R2-MEAL-1; PLN-2, PLN-3). Basic: switch
// meals on or off. Detailed: times, shared or individual, packed and reheat, rules for the recipe
// writer, custom meals. Expert: who eats which meal on which day. Slots are grouped under Shared
// and Individual (R2-MEAL-1); a packed lunch "replaces lunch" in one tap (PLN-3).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { DEFAULT_SLOTS } from "@mealplanner/core/types";
import { WEEKDAY_SHORT, weekdayText } from "@mealplanner/core/onboarding";
import { applyChanges, problemText } from "./api";
import { hhmm, levelOf, useHousehold, type HouseholdData, type Member, type Slot } from "./data";
import { ErrorBlock, LoadingBlock, SaveStatus, Section } from "./parts";
import {
  AutoTag,
  DetailControl,
  TellAssistant,
  useDetailLevel,
} from "../detail-level/detail-control";
import { levelRank, type Level } from "../detail-level/logic";
import { Icon } from "../ui/icon";
import { TabLinks } from "../ui/tab-links";

export interface SettingsTab {
  readonly label: string;
  readonly href: string;
}

const HINTS: Readonly<Record<Level, string>> = {
  basic:
    "Basic: switch meals on or off. Detailed adds times, shared or individual, packed lunches and custom meals.",
  detailed: "Detailed: times, shared or individual, packed. Expert adds who eats what, day by day.",
  expert: "Expert: who eats what, day by day.",
};

const DETAIL_FIELDS = ["defaultTime", "isShared", "isPacked", "reheatAvailable"] as const;

function defaultOf(slot: Slot) {
  return DEFAULT_SLOTS.find((d) => d.key === slot.key);
}

/** Detailed-level fields of a slot that differ from PLN-2 (custom slots count as one). */
function changedFields(slot: Slot): number {
  const d = defaultOf(slot);
  if (d === undefined) return slot.active ? 1 : 0;
  return (
    DETAIL_FIELDS.filter((f) => slot[f] !== d[f]).length + (slot.constraintsNote === null ? 0 : 1)
  );
}

/** Whether a member eats a slot on a weekday (02 §2: row, else coarse default). */
export function attends(data: HouseholdData, member: Member, slot: Slot, weekday: number): boolean {
  const row = data.schedules.slotSchedules.find(
    (r) => r.memberId === member.id && r.slotTypeId === slot.id && r.weekday === weekday,
  );
  if (slot.isTrainingSlot) {
    const trains = data.schedules.training.some(
      (t) => t.memberId === member.id && t.weekday === weekday,
    );
    return trains && (row?.attends ?? true);
  }
  return row?.attends ?? true;
}

function scheduleGroups(
  data: HouseholdData,
): Map<string, { memberId: string; slotTypeId: string; days: number[] }> {
  const groups = new Map<string, { memberId: string; slotTypeId: string; days: number[] }>();
  for (const r of data.schedules.slotSchedules) {
    const key = `${r.memberId}|${r.slotTypeId}`;
    const g = groups.get(key) ?? { memberId: r.memberId, slotTypeId: r.slotTypeId, days: [] };
    g.days.push(r.weekday);
    groups.set(key, g);
  }
  return groups;
}

export function ScheduleScreen({ tabs }: { readonly tabs: readonly SettingsTab[] }) {
  const { data, error, loading, reload } = useHousehold();
  if (data === null)
    return error === null || loading ? (
      <LoadingBlock label="Loading meals and schedule" />
    ) : (
      <ErrorBlock message={error} onRetry={() => void reload()} />
    );
  return <Schedule data={data} reload={reload} tabs={tabs} />;
}

function Schedule({
  data,
  reload,
  tabs,
}: {
  readonly data: HouseholdData;
  readonly reload: () => Promise<void>;
  readonly tabs: readonly SettingsTab[];
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(null, "slots", levelOf(data, null, "slots"));
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selectedKey =
    params.get("slot") ?? data.slots.find((s) => s.active)?.key ?? data.slots[0]?.key;
  const selected = data.slots.find((s) => s.key === selectedKey) ?? data.slots[0];
  const run = async (summary: string, ops: ChangeOp[]) => {
    if (ops.length === 0) return;
    try {
      await applyChanges(summary, ops);
      setError(null);
      setSaved(true);
      await reload();
    } catch (e) {
      setError(problemText(e));
    }
  };
  const hiddenAt = (l: Level) =>
    (levelRank(l) < 1 ? data.slots.reduce((n, s) => n + changedFields(s), 0) : 0) +
    (levelRank(l) < 2 ? scheduleGroups(data).size : 0);
  const reset = async (l: Level) => {
    const ops: ChangeOp[] = [];
    if (levelRank(l) < 1)
      for (const slot of data.slots) {
        const d = defaultOf(slot);
        if (d === undefined) {
          if (slot.active)
            ops.push({ kind: "slot.update", payload: { slotTypeId: slot.id, active: false } });
        } else if (changedFields(slot) > 0) {
          ops.push({
            kind: "slot.update",
            payload: {
              slotTypeId: slot.id,
              defaultTime: d.defaultTime,
              isShared: d.isShared,
              isPacked: d.isPacked,
              reheatAvailable: d.reheatAvailable,
              constraintsNote: null,
            },
          });
        }
      }
    for (const g of scheduleGroups(data).values())
      ops.push({
        kind: "slot_schedule.set",
        payload: {
          memberId: g.memberId,
          slotTypeId: g.slotTypeId,
          days: g.days.map((weekday) => ({ weekday, attends: null })),
        },
      });
    if (ops.length > 0) await applyChanges("Reset meals and schedule to automatic", ops);
    await reload();
  };
  const shared = data.slots.filter((s) => s.isShared);
  const individual = data.slots.filter((s) => !s.isShared);
  const list = (slots: Slot[]) =>
    slots.map((slot) => {
      const badge = slot.isPacked
        ? slot.reheatAvailable
          ? "packed · microwave"
          : "packed · cold"
        : slot.isTrainingSlot
          ? "training days"
          : null;
      const current = slot.id === selected?.id;
      return (
        <li
          key={slot.id}
          data-slot-row={slot.key}
          className={`flex items-center gap-2 rounded-lg px-2 py-1 ${current ? "border-2 border-action bg-tomato-tint" : ""}`}
        >
          <input
            type="checkbox"
            checked={slot.active}
            aria-label={`${slot.label} on`}
            onChange={() =>
              void run(`${slot.active ? "Turn off" : "Turn on"} ${slot.label}`, [
                { kind: "slot.update", payload: { slotTypeId: slot.id, active: !slot.active } },
              ])
            }
            className="size-5 shrink-0 accent-[var(--action)]"
          />
          <button
            type="button"
            onClick={() => {
              router.replace(`/settings/schedule?slot=${slot.key}`, { scroll: false });
            }}
            aria-current={current ? "true" : undefined}
            className="flex min-h-11 grow items-center justify-between gap-2 text-left text-[17px] font-extrabold text-ink"
          >
            {slot.label}
            {badge === null ? (
              <span className="tabular text-sm font-medium">{hhmm(slot.defaultTime)}</span>
            ) : (
              <span className="rounded-full bg-flour px-2 py-0.5 text-xs">{badge}</span>
            )}
          </button>
        </li>
      );
    });
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[34px]">Meals &amp; schedule</h1>
        <TabLinks items={tabs} activeHref="/settings/schedule" label="Settings sections" />
        <p className="m-0 text-ink-soft">
          Which meals your household has, and who eats which meal on which day.
        </p>
        <DetailControl
          scope="meals and schedule"
          level={level}
          onLevel={change}
          hints={HINTS}
          hiddenAt={hiddenAt}
          onReset={reset}
          error={levelError}
        />
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <section
          aria-label="Meals"
          className="flex shrink-0 flex-col gap-3 rounded-2xl bg-card p-4 shadow-card lg:w-[300px]"
        >
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-1.5 font-body text-sm font-extrabold tracking-wider text-sea-text uppercase">
              <Icon name="family" size={16} /> Shared meals
            </h2>
            <p className="m-0 text-[13px] text-ink-soft">
              One dish for everyone at the table. Portions and cooking method differ per person.
            </p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{list(shared)}</ul>
          <hr className="m-0 border-line" />
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-1.5 font-body text-sm font-extrabold tracking-wider text-saffron-text uppercase">
              <Icon name="me" size={16} /> Individual meals
            </h2>
            <p className="m-0 text-[13px] text-ink-soft">
              Each person gets their own dish, chosen for them.
            </p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">{list(individual)}</ul>
          {levelRank(level) >= 1 && (
            <AddCustomMeal onAdd={(ops, label) => run(`Add ${label}`, ops)} />
          )}
        </section>
        <div className="flex min-w-0 grow flex-col gap-4">
          {selected !== undefined && (
            <SlotPane
              key={`${selected.id}${JSON.stringify(selected)}`}
              data={data}
              slot={selected}
              level={level}
              run={run}
            />
          )}
          <Glance data={data} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SaveStatus error={error} saved={saved} />
            <TellAssistant prompt="Change our meals: " />
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotPane({
  data,
  slot,
  level,
  run,
}: {
  readonly data: HouseholdData;
  readonly slot: Slot;
  readonly level: Level;
  readonly run: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const d = defaultOf(slot);
  const detailed = levelRank(level) >= 1;
  const [time, setTime] = useState(hhmm(slot.defaultTime));
  const [note, setNote] = useState(slot.constraintsNote ?? "");
  const attendees = data.members.filter((m) =>
    [0, 1, 2, 3, 4, 5, 6].some((w) => attends(data, m, slot, w)),
  );
  const update = (
    summary: string,
    payload: {
      defaultTime?: string;
      isShared?: boolean;
      isPacked?: boolean;
      reheatAvailable?: boolean;
      constraintsNote?: string | null;
    },
  ) => run(summary, [{ kind: "slot.update", payload: { slotTypeId: slot.id, ...payload } }]);
  const lunch = data.slots.find((s) => s.key === "lunch");
  const eatDays = (m: Member) => [0, 1, 2, 3, 4, 5, 6].filter((w) => attends(data, m, slot, w));
  const replacesLunch =
    lunch !== undefined &&
    attendees.length > 0 &&
    attendees.every((m) => eatDays(m).every((w) => !attends(data, m, lunch, w)));
  const toggleReplaces = () => {
    if (lunch === undefined) return;
    const ops: ChangeOp[] = attendees
      .filter((m) => eatDays(m).length > 0)
      .map((m) => ({
        kind: "slot_schedule.set",
        payload: {
          memberId: m.id,
          slotTypeId: lunch.id,
          days: eatDays(m).map((weekday) => ({ weekday, attends: replacesLunch ? null : false })),
        },
      }));
    void run(
      replacesLunch ? `${slot.label} no longer replaces lunch` : `${slot.label} replaces lunch`,
      ops,
    );
  };
  const auto = (field: (typeof DETAIL_FIELDS)[number]) =>
    d === undefined || slot[field] !== d[field] ? "yours" : "auto";
  return (
    <Section
      id="slot"
      title={slot.label}
      control={
        <span className="text-sm text-ink-soft">
          {slot.active ? `Eaten ~${hhmm(slot.defaultTime)}` : "Off"}
        </span>
      }
    >
      <div
        role="radiogroup"
        aria-label="Shared or individual"
        className="grid gap-2.5 sm:grid-cols-2"
      >
        {([true, false] as const).map((isShared) => {
          const on = slot.isShared === isShared;
          return (
            <button
              key={String(isShared)}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!detailed}
              onClick={() =>
                void update(`${slot.label}: ${isShared ? "shared" : "individual"}`, { isShared })
              }
              className={`flex flex-col gap-1 rounded-xl p-3.5 text-left ${on ? "border-2 border-sea bg-sea-tint text-sea-text" : "border-[1.5px] border-line-strong bg-card text-ink"}`}
            >
              <span className="flex items-center gap-2 font-extrabold">
                <Icon name={isShared ? "family" : "me"} size={16} />
                {isShared ? "Shared" : "Individual"}
              </span>
              <span className="text-[13px]">
                {isShared
                  ? `${attendees.length > 0 ? attendees.map((m) => m.displayName).join(", ") : "Everyone"} get the same dish, each portioned for them.`
                  : "Each person gets a different dish, picked for their own tastes."}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AutoTag state={auto("isShared")} editable={false} what="shared or individual" />
        {!detailed && (
          <span className="text-sm text-ink-soft">Switch to Detailed to change this.</span>
        )}
      </div>
      {detailed && (
        <div className="flex flex-wrap gap-2.5">
          <label className="flex min-h-11 items-center gap-2 rounded-lg bg-flour px-3.5 font-extrabold">
            Time
            <input
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
              }}
              onBlur={() => {
                if (time !== "" && time !== hhmm(slot.defaultTime))
                  void update(`${slot.label} at ${time}`, { defaultTime: `${time}:00` });
              }}
              className="min-h-9 rounded-md bg-card px-2"
            />
            <AutoTag
              state={auto("defaultTime")}
              editable
              what={`${slot.label} time`}
              onBackToAuto={
                d === undefined
                  ? undefined
                  : () =>
                      void update(`${slot.label} time back to automatic`, {
                        defaultTime: d.defaultTime,
                      })
              }
            />
          </label>
          {slot.isPacked && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-flour px-3.5 font-extrabold">
              <input
                type="checkbox"
                checked={slot.reheatAvailable}
                onChange={() =>
                  void update(
                    `${slot.label}: ${slot.reheatAvailable ? "no reheating" : "can be reheated"}`,
                    { reheatAvailable: !slot.reheatAvailable },
                  )
                }
                className="size-5 accent-[var(--action)]"
              />
              Can be reheated
            </label>
          )}
          {slot.isPacked && lunch !== undefined && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-flour px-3.5 font-extrabold">
              <input
                type="checkbox"
                checked={replacesLunch}
                onChange={toggleReplaces}
                className="size-5 accent-[var(--action)]"
              />
              Replaces lunch on the days it&apos;s on
            </label>
          )}
          {!slot.isTrainingSlot && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-flour px-3.5 font-extrabold">
              <input
                type="checkbox"
                checked={slot.isPacked}
                onChange={() =>
                  void update(
                    `${slot.label}: ${slot.isPacked ? "not packed" : "packed"}`,
                    slot.isPacked
                      ? { isPacked: false, reheatAvailable: false }
                      : { isPacked: true },
                  )
                }
                className="size-5 accent-[var(--action)]"
              />
              Packed
            </label>
          )}
        </div>
      )}
      {detailed && (
        <label className="flex flex-col gap-1.5 font-extrabold">
          Rules for the recipe writer
          <input
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            onBlur={() => {
              const next = note.trim() === "" ? null : note.trim();
              if (next !== slot.constraintsNote)
                void update(`${slot.label}: rules for the recipe writer`, {
                  constraintsNote: next,
                });
            }}
            placeholder="For example: school is nut-free; no fridge for 5 hours."
            className="min-h-12 rounded-lg border-[1.5px] border-line-strong bg-card px-3.5 font-bold"
          />
        </label>
      )}
      {levelRank(level) === 2 ? (
        <AttendanceGrid data={data} slot={slot} run={run} />
      ) : (
        <p className="m-0 text-sm text-ink-soft">
          {slot.isTrainingSlot
            ? "Eaten on each person's training days."
            : attendees.length === data.members.length
              ? "Everyone, every day."
              : attendees.map((m) => `${m.displayName} ${weekdayText(eatDays(m))}`).join(" · ") ||
                "No one."}
        </p>
      )}
    </Section>
  );
}

function AttendanceGrid({
  data,
  slot,
  run,
}: {
  readonly data: HouseholdData;
  readonly slot: Slot;
  readonly run: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table
        className="w-full border-separate border-spacing-1.5 text-sm"
        data-attendance={slot.key}
      >
        <caption className="sr-only-focusable">Who eats {slot.label} on which day</caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only-focusable">Person</span>
            </th>
            {WEEKDAY_SHORT.map((d) => (
              <th key={d} scope="col" className="font-extrabold">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => (
            <tr key={m.id}>
              <th scope="row" className="pr-2 text-left font-extrabold">
                {m.displayName}
              </th>
              {WEEKDAY_SHORT.map((day, weekday) => {
                const on = attends(data, m, slot, weekday);
                const row = data.schedules.slotSchedules.find(
                  (r) => r.memberId === m.id && r.slotTypeId === slot.id && r.weekday === weekday,
                );
                return (
                  <td key={day}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${m.displayName} eats ${slot.label} on ${day}${row === undefined ? " (automatic)" : ""}`}
                      disabled={slot.isTrainingSlot}
                      onClick={() =>
                        void run(`${m.displayName}: ${slot.label} on ${day}`, [
                          {
                            kind: "slot_schedule.set",
                            payload: {
                              memberId: m.id,
                              slotTypeId: slot.id,
                              days: [{ weekday, attends: !on }],
                            },
                          },
                        ])
                      }
                      className={`flex h-11 w-full min-w-11 items-center justify-center rounded-md ${on ? "bg-basil-text text-paper" : "bg-flour text-ink-soft"}`}
                    >
                      {on ? <Icon name="check" size={18} /> : <span className="text-xs">off</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {slot.isTrainingSlot && (
        <p className="m-0 text-xs text-ink-soft">
          Follows each person&apos;s training days (Family › Training).
        </p>
      )}
    </div>
  );
}

function AddCustomMeal({
  onAdd,
}: {
  readonly onAdd: (ops: ChangeOp[], label: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("10:30");
  const [isShared, setShared] = useState(false);
  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="min-h-12 rounded-xl border-[1.5px] border-dashed border-action font-extrabold text-action"
      >
        Add a custom meal
      </button>
    );
  return (
    <form
      aria-label="Add a custom meal"
      className="flex flex-col gap-2 rounded-lg bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (label.trim() === "") return;
        const key = `custom_${Math.random().toString(36).slice(2, 8)}`;
        void onAdd(
          [
            {
              kind: "slot.create",
              payload: {
                key,
                label: label.trim(),
                icon: "utensils",
                sortOrder: 70,
                defaultTime: `${time}:00`,
                isShared,
                isPacked: false,
                reheatAvailable: false,
                isTrainingSlot: false,
                active: true,
              },
            },
          ],
          label.trim(),
        ).then(() => {
          setOpen(false);
          setLabel("");
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Name
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Time
        <input
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-extrabold">
        <input
          type="checkbox"
          checked={isShared}
          onChange={() => {
            setShared(!isShared);
          }}
          className="size-5"
        />
        Shared (one dish for everyone)
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Glance({ data }: { readonly data: HouseholdData }) {
  const parts: string[] = [];
  for (const slot of data.slots.filter((s) => s.isPacked && s.active)) {
    const perDay = [0, 1, 2, 3, 4].map(
      (w) => data.members.filter((m) => attends(data, m, slot, w)).length,
    );
    const most = Math.max(...perDay);
    if (most > 0)
      parts.push(
        `${String(most)} ${slot.label.toLowerCase()}${most === 1 ? "" : "es"} on busy weekdays`,
      );
  }
  for (const m of data.members) {
    const days = data.schedules.training.filter((t) => t.memberId === m.id).length;
    if (days > 0) parts.push(`${m.displayName} trains ${String(days)} day${days === 1 ? "" : "s"}`);
  }
  return (
    <section
      aria-label="This week at a glance"
      className="flex flex-wrap items-center gap-4 rounded-2xl bg-card p-4 shadow-card"
    >
      <span className="font-display text-lg font-bold">This week at a glance</span>
      <span className="grow text-sm text-ink-soft">
        {parts.join(" · ") || "Breakfast, lunch, dinner and a snack for everyone."}
      </span>
      <Link href="/plan" className="font-extrabold">
        Open week plan
      </Link>
    </section>
  );
}
