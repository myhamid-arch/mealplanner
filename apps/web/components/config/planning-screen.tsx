"use client";
// Planning balance (PlanningBalance.dc.html; UX-2 Planning; PRD-2). Basic: one preset. Detailed:
// weight sliders and fairness. Expert: weekday presets, adjusters, variants per component, the
// economy window and AI recipes. Macros always stay within each person's precision (PRD-2).
// At Detailed and Expert the "Next week, if you save" panel (W-5, leaf 1.4.7, R-56) previews the
// draft weights and saves and replans; at Basic, presets apply on tap and next week can be
// replanned.
import Link from "next/link";
import { useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { DEFAULT_PLANNING_WEIGHTS } from "@mealplanner/core/types";
import { WEEKDAY_SHORT, weekdayText } from "@mealplanner/core/onboarding";
import { api, applyChanges, c, problemText } from "./api";
import { levelOf, useHousehold, type HouseholdData, type Preset, type Weights } from "./data";
import { ErrorBlock, LoadingBlock, SaveStatus, Section, WeekdayPicker } from "./parts";
import type { SettingsTab } from "./schedule-screen";
import {
  AutoTag,
  DetailControl,
  TellAssistant,
  useDetailLevel,
} from "../detail-level/detail-control";
import { levelRank, type Level } from "../detail-level/logic";
import { TabLinks } from "../ui/tab-links";
import { PlanPreviewPanel } from "../setup/plan-preview-panel";

type Weight = "macroPrecision" | "appeal" | "ingredientEconomy" | "variety" | "fairness";
type WeightValues = Record<Weight, number>;

/** leaf-1.4.3 SPEC-Q-18: the four presets of PlanningBalance.dc.html. Balanced = the 02 §6 defaults. */
export const PRESETS: readonly { name: string; text: string; values: WeightValues }[] = [
  {
    name: "Macros first",
    text: "Plates dead-centre on target",
    values: { macroPrecision: 1, appeal: 0.4, ingredientEconomy: 0.3, variety: 0.3, fairness: 0.5 },
  },
  {
    name: "Balanced",
    text: "The default",
    values: {
      macroPrecision: DEFAULT_PLANNING_WEIGHTS.macroPrecision,
      appeal: DEFAULT_PLANNING_WEIGHTS.appeal,
      ingredientEconomy: DEFAULT_PLANNING_WEIGHTS.ingredientEconomy,
      variety: DEFAULT_PLANNING_WEIGHTS.variety,
      fairness: DEFAULT_PLANNING_WEIGHTS.fairness,
    },
  },
  {
    name: "Crowd-pleaser",
    text: "Favourites more often",
    values: { macroPrecision: 1, appeal: 0.9, ingredientEconomy: 0.2, variety: 0.2, fairness: 0.5 },
  },
  {
    name: "Fewest ingredients",
    text: "Reuse, reuse, reuse",
    values: { macroPrecision: 1, appeal: 0.4, ingredientEconomy: 0.8, variety: 0.2, fairness: 0.5 },
  },
];

const SLIDERS: readonly { key: Weight; label: string; help: string; cls: string }[] = [
  {
    key: "macroPrecision",
    label: "Macro precision",
    help: "Higher: plates sit closer to the centre of the target instead of just inside the limits.",
    cls: "text-tomato-text accent-[var(--tomato-text)]",
  },
  {
    key: "appeal",
    label: "Appeal",
    help: "Cuisines, likes, ratings.",
    cls: "text-basil-text accent-[var(--basil-text)]",
  },
  {
    key: "ingredientEconomy",
    label: "Ingredient economy",
    help: "Reuse ingredients across the week. Vary how they're cooked instead of buying new ones.",
    cls: "text-sea-text accent-[var(--sea-text)]",
  },
  {
    key: "variety",
    label: "Variety",
    help: "Higher: fewer repeats of the same dish.",
    cls: "text-aubergine-text accent-[var(--aubergine-text)]",
  },
  {
    key: "fairness",
    label: "Fairness",
    help: "Higher: avoid dishes that anyone dislikes, even if others love them.",
    cls: "text-aubergine-text accent-[var(--aubergine-text)]",
  },
];

const HINTS: Readonly<Record<Level, string>> = {
  basic: "Basic: pick a preset. Detailed lets you fine-tune each weight.",
  detailed:
    "Detailed: fine-tune each weight. Expert adds different settings for different days, adjusters and AI recipes.",
  expert:
    "Expert: different settings for different days, adjusters, variants per dish, the economy window and AI recipes.",
};

const EXPERT_DEFAULTS = {
  adjustersEnabled: DEFAULT_PLANNING_WEIGHTS.adjustersEnabled,
  maxVariantsPerComponent: DEFAULT_PLANNING_WEIGHTS.maxVariantsPerComponent,
  economyWindowDays: DEFAULT_PLANNING_WEIGHTS.economyWindowDays,
  aiGeneration: DEFAULT_PLANNING_WEIGHTS.aiGeneration,
} as const;

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
function presetOf(w: Weights) {
  return PRESETS.find((p) =>
    (Object.keys(p.values) as Weight[]).every((k) => same(p.values[k], w[k])),
  );
}
function expertChanged(w: Weights): number {
  return (Object.keys(EXPERT_DEFAULTS) as (keyof typeof EXPERT_DEFAULTS)[]).filter(
    (k) => w[k] !== EXPERT_DEFAULTS[k],
  ).length;
}

function tomorrow(timezone: string): Date {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function PlanningScreen({ tabs }: { readonly tabs: readonly SettingsTab[] }) {
  const { data, error, loading, reload } = useHousehold();
  // Kept here: saving from the preview panel reloads (and remounts) the screen below.
  const [replanned, setReplanned] = useState(false);
  if (data === null)
    return error === null || loading ? (
      <LoadingBlock label="Loading planning balance" />
    ) : (
      <ErrorBlock message={error} onRetry={() => void reload()} />
    );
  return (
    <Planning
      key={JSON.stringify(data.weights)}
      data={data}
      reload={reload}
      tabs={tabs}
      replanned={replanned}
      onReplanned={() => {
        setReplanned(true);
      }}
    />
  );
}

function Planning({
  data,
  reload,
  tabs,
  replanned,
  onReplanned,
}: {
  readonly data: HouseholdData;
  readonly reload: () => Promise<void>;
  readonly tabs: readonly SettingsTab[];
  readonly replanned: boolean;
  readonly onReplanned: () => void;
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(null, "planning", levelOf(data, null, "planning"));
  const w = data.weights;
  const [draft, setDraft] = useState<WeightValues>({
    macroPrecision: w.macroPrecision,
    appeal: w.appeal,
    ingredientEconomy: w.ingredientEconomy,
    variety: w.variety,
    fairness: w.fairness,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [replan, setReplan] = useState<"idle" | "queued" | "failed">("idle");
  const current = presetOf(w);
  const run = async (summary: string, ops: ChangeOp[]) => {
    try {
      await applyChanges(summary, ops);
      setError(null);
      setSaved(true);
      await reload();
    } catch (e) {
      setError(problemText(e));
    }
  };
  const savedValues: WeightValues = {
    macroPrecision: w.macroPrecision,
    appeal: w.appeal,
    ingredientEconomy: w.ingredientEconomy,
    variety: w.variety,
    fairness: w.fairness,
  };
  const hiddenAt = (l: Level) =>
    (levelRank(l) < 1 && current === undefined ? 1 : 0) +
    (levelRank(l) < 2 ? data.presets.length + expertChanged(w) : 0);
  const reset = async (l: Level) => {
    const ops: ChangeOp[] = data.presets.map((p) => ({
      kind: "preset.delete",
      payload: { presetId: p.id },
    }));
    if (expertChanged(w) > 0) ops.push({ kind: "weights.set", payload: { ...EXPERT_DEFAULTS } });
    if (levelRank(l) < 1 && current === undefined)
      ops.push({ kind: "weights.set", payload: PRESETS[1]?.values ?? {} });
    if (ops.length > 0) await applyChanges("Reset planning balance to automatic", ops);
    await reload();
  };
  const replanWeek = async () => {
    const start = tomorrow(data.household.timezone);
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    try {
      await api.call(c.plansGenerate, { body: { dates } });
      setReplan("queued");
    } catch {
      setReplan("failed");
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[34px]">Planning balance</h1>
        <TabLinks items={tabs} activeHref="/settings/planning" label="Settings sections" />
        <p className="m-0 text-ink-soft">
          Macros are always kept within each person&apos;s precision. Basic: pick a preset.
          Detailed: fine-tune below. Expert: different settings for different days.
        </p>
        <DetailControl
          scope="planning balance"
          level={level}
          onLevel={change}
          hints={HINTS}
          hiddenAt={hiddenAt}
          onReset={reset}
          error={levelError}
        />
      </div>
      <div
        role="radiogroup"
        aria-label="Preset"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {PRESETS.map((p) => {
          const on = current?.name === p.name;
          return (
            <button
              key={p.name}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() =>
                void run(`Planning balance: ${p.name}`, [
                  { kind: "weights.set", payload: p.values },
                ])
              }
              className={`flex flex-col gap-1 rounded-xl bg-card p-4 text-left ${on ? "border-2 border-action" : "border-[1.5px] border-line-strong"}`}
            >
              <span className="text-[17px] font-extrabold text-ink">{p.name}</span>
              <span className="text-[13px] text-ink-soft">
                {on ? "Your current setting" : p.text}
              </span>
            </button>
          );
        })}
      </div>
      {current === undefined && (
        <p className="m-0 text-sm text-ink-soft">
          Your current setting is your own mix (see Fine-tune).
        </p>
      )}
      {levelRank(level) >= 1 && (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <Section id="fine-tune" title="Fine-tune" className="grow">
            {SLIDERS.map((s, i) => {
              const own = !same(draft[s.key], PRESETS[1]?.values[s.key] ?? 0);
              return (
                <div
                  key={s.key}
                  className={`flex flex-col gap-1.5 ${i === 3 ? "border-t border-line pt-3" : ""}`}
                  data-weight={s.key}
                >
                  <label
                    className={`flex items-center justify-between gap-2 text-[17px] font-extrabold ${s.cls}`}
                  >
                    {s.label}
                    <span className="tabular text-ink">{draft[s.key].toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    aria-label={s.label}
                    value={Math.round(draft[s.key] * 10)}
                    onChange={(e) => {
                      setDraft({ ...draft, [s.key]: Number(e.target.value) / 10 });
                    }}
                    className={`w-full ${s.cls}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grow text-[13px] text-ink-soft">{s.help}</span>
                    <AutoTag
                      state={own ? "yours" : "auto"}
                      editable
                      what={s.label}
                      onBackToAuto={() => {
                        setDraft({ ...draft, [s.key]: PRESETS[1]?.values[s.key] ?? draft[s.key] });
                      }}
                    />
                  </div>
                </div>
              );
            })}
            {levelRank(level) === 2 && <WeekdayPresets data={data} run={run} />}
          </Section>
          <PlanPreviewPanel
            draft={draft}
            saved={savedValues}
            timezone={data.household.timezone}
            members={data.members}
            replanned={replanned}
            onReset={() => {
              setDraft(savedValues);
            }}
            onSaved={async () => {
              onReplanned();
              setSaved(true);
              await reload();
            }}
          />
        </div>
      )}
      {levelRank(level) === 2 && <ExpertSettings weights={w} run={run} />}
      {levelRank(level) === 0 && (
        <section
          aria-label="Replan"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-card"
        >
          <p className="m-0 grow text-sm text-ink-soft">
            New settings apply to the next plan. Unlocked meals of the coming week can be planned
            again now.
          </p>
          {replan === "queued" ? (
            <Link href="/plan" className="font-extrabold">
              Replanning next week: open the plan
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void replanWeek()}
              className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
            >
              Replan next week
            </button>
          )}
          {replan === "failed" && (
            <p role="alert" className="m-0 w-full text-sm font-bold text-pomegranate-text">
              The plan could not be started. Try again in a moment.
            </p>
          )}
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <TellAssistant prompt="Change the planning balance: " />
      </div>
    </div>
  );
}

function WeekdayPresets({
  data,
  run,
}: {
  readonly data: HouseholdData;
  readonly run: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Preset | "new" | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {data.presets.map((p) => {
        const v = p.values as Partial<WeightValues>;
        return (
          <div
            key={p.id}
            className="flex flex-wrap items-center gap-2.5 rounded-lg bg-flour px-3.5 py-3"
            data-preset={p.name}
          >
            <span className="font-extrabold">{p.name} preset</span>
            <span className="grow text-sm text-ink-soft">
              {p.appliesToWeekdays === null ? "any day" : weekdayText(p.appliesToWeekdays)}
              {v.appeal === undefined ? "" : ` · appeal ${v.appeal.toFixed(1)}`}
              {v.ingredientEconomy === undefined
                ? ""
                : ` · economy ${v.ingredientEconomy.toFixed(1)}`}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(p);
              }}
              className="min-h-11 font-extrabold text-ink underline"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() =>
                void run(`Delete preset "${p.name}"`, [
                  { kind: "preset.delete", payload: { presetId: p.id } },
                ])
              }
              className="min-h-11 font-extrabold text-ink underline"
            >
              Delete
            </button>
          </div>
        );
      })}
      {editing === null ? (
        <button
          type="button"
          onClick={() => {
            setEditing("new");
          }}
          className="min-h-11 w-fit rounded-md border-[1.5px] border-dashed border-action px-4 font-extrabold text-action"
        >
          Add a weekday preset
        </button>
      ) : (
        <PresetForm
          preset={editing === "new" ? null : editing}
          onCancel={() => {
            setEditing(null);
          }}
          onSave={async (op, name) => {
            await run(`Save preset "${name}"`, [op]);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PresetForm({
  preset,
  onCancel,
  onSave,
}: {
  readonly preset: Preset | null;
  readonly onCancel: () => void;
  readonly onSave: (op: ChangeOp, name: string) => Promise<void>;
}) {
  const v = (preset?.values ?? {}) as Partial<WeightValues>;
  const [name, setName] = useState(preset?.name ?? "Weekend");
  const [days, setDays] = useState<number[]>(preset?.appliesToWeekdays ?? [5, 6]);
  const [appeal, setAppeal] = useState(v.appeal ?? 0.8);
  const [economy, setEconomy] = useState(v.ingredientEconomy ?? 0.2);
  return (
    <form
      aria-label="Weekday preset"
      className="flex flex-col gap-3 rounded-lg bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() === "" || days.length === 0) return;
        void onSave(
          {
            kind: "preset.upsert",
            payload: {
              ...(preset === null ? {} : { id: preset.id }),
              name: name.trim(),
              values: { appeal, ingredientEconomy: economy },
              appliesToWeekdays: days,
            },
          },
          name.trim(),
        );
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-extrabold">
        Name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
        />
      </label>
      <WeekdayPicker label="Days" value={days} onChange={setDays} />
      {(
        [
          ["Appeal", appeal, setAppeal],
          ["Ingredient economy", economy, setEconomy],
        ] as const
      ).map(([label, value, set]) => (
        <label key={label} className="flex flex-col gap-1 text-sm font-extrabold">
          {label} {value.toFixed(1)}
          <input
            type="range"
            min={0}
            max={10}
            value={Math.round(value * 10)}
            onChange={(e) => {
              set(Number(e.target.value) / 10);
            }}
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Save preset
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
        >
          Cancel
        </button>
      </div>
      <p className="m-0 text-xs text-ink-soft">
        On these days: {WEEKDAY_SHORT.filter((_, i) => days.includes(i)).join(", ") || "none"}.
      </p>
    </form>
  );
}

function ExpertSettings({
  weights,
  run,
}: {
  readonly weights: Weights;
  readonly run: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const set = (summary: string, payload: Extract<ChangeOp, { kind: "weights.set" }>["payload"]) =>
    run(summary, [{ kind: "weights.set", payload }]);
  const tag = (k: keyof typeof EXPERT_DEFAULTS, what: string) => (
    <AutoTag
      state={weights[k] === EXPERT_DEFAULTS[k] ? "auto" : "yours"}
      editable
      what={what}
      onBackToAuto={() => void set(`${what} back to automatic`, { [k]: EXPERT_DEFAULTS[k] })}
    />
  );
  return (
    <Section id="expert" title="More planning settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-wrap items-center gap-2 rounded-lg bg-flour px-3.5 py-2.5 font-extrabold">
          <input
            type="checkbox"
            checked={weights.adjustersEnabled}
            onChange={() => void set("Adjusters", { adjustersEnabled: !weights.adjustersEnabled })}
            className="size-5"
          />
          Use adjusters to close small gaps
          {tag("adjustersEnabled", "Adjusters")}
        </label>
        <label className="flex flex-wrap items-center gap-2 rounded-lg bg-flour px-3.5 py-2.5 font-extrabold">
          Variants per dish part
          <select
            value={weights.maxVariantsPerComponent}
            onChange={(e) =>
              void set("Variants per dish part", {
                maxVariantsPerComponent: Number(e.target.value),
              })
            }
            className="min-h-11 rounded-md bg-card px-2"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {tag("maxVariantsPerComponent", "Variants per dish part")}
        </label>
        <label className="flex flex-wrap items-center gap-2 rounded-lg bg-flour px-3.5 py-2.5 font-extrabold">
          Ingredient economy over
          <select
            value={weights.economyWindowDays}
            onChange={(e) =>
              void set("Economy window", { economyWindowDays: Number(e.target.value) })
            }
            className="min-h-11 rounded-md bg-card px-2"
          >
            {[3, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </select>
          {tag("economyWindowDays", "Economy window")}
        </label>
        <label className="flex flex-wrap items-center gap-2 rounded-lg bg-flour px-3.5 py-2.5 font-extrabold">
          AI recipes
          <select
            value={weights.aiGeneration}
            onChange={(e) =>
              void set("AI recipes", { aiGeneration: e.target.value as Weights["aiGeneration"] })
            }
            className="min-h-11 rounded-md bg-card px-2"
          >
            <option value="auto">Straight into plans</option>
            <option value="ask">Ask me first</option>
            <option value="off">Never</option>
          </select>
          {tag("aiGeneration", "AI recipes")}
        </label>
      </div>
    </Section>
  );
}
