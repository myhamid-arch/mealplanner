"use client";
// Daily targets (UX-2 Targets; MemberSimple / MemberDetailed / DetailLevels):
// Basic: daily kcal + P/C/F. Detailed: + training-day targets, saturated-fat cap, soluble-fibre
// goal. Expert: + fibre, sodium, this person's precision per meal, strict/flexible.
// Automatic values are always shown with `auto` (R2-DL-3): sat fat 6 % of energy
// (household.sat_fat_default_pct, R-28 OQ-4), fibre 14 g per 1,000 kcal of which 25 % soluble
// (R-28), the household precision P ±5 / C ±5 / F ±2 per meal and kcal ±50 per day (R-28 OQ-2).
// Carbohydrate is total (R-20, R-28 OQ-7).
import { useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { DEFAULT_TOLERANCE } from "@mealplanner/core/types";
import { FIBRE_G_PER_1000_KCAL, SOLUBLE_SHARE } from "@mealplanner/core/onboarding";
import { applyChanges, problemText } from "./api";
import {
  levelOf,
  type HouseholdData,
  type Member,
  type TargetProfile,
  type Tolerance,
} from "./data";
import { readNumber, SaveStatus, Section } from "./parts";
import {
  AutoTag,
  DetailControl,
  TellAssistant,
  useDetailLevel,
} from "../detail-level/detail-control";
import { levelRank, type Level } from "../detail-level/logic";

const HINTS: Readonly<Record<Level, string>> = {
  basic:
    "Basic: one set of daily numbers. The app splits them across meals and holds each meal to the household precision. Detailed adds training-day targets, saturated fat and soluble fibre.",
  detailed:
    "Detailed adds: different numbers on training days, a saturated-fat cap and a soluble-fibre goal. Expert adds fibre, sodium and this person's own precision.",
  expert:
    "Expert adds: this person's own precision per meal, fibre and sodium, and strict or flexible mode.",
};

type Macro = "kcal" | "proteinG" | "carbsG" | "fatG";
const MACROS: readonly { key: Macro; label: string; tile: string; text: string }[] = [
  { key: "kcal", label: "Calories", tile: "bg-tomato-tint", text: "text-tomato-text" },
  { key: "proteinG", label: "Protein g", tile: "bg-sea-tint", text: "text-sea-text" },
  { key: "carbsG", label: "Carbs g (total)", tile: "bg-saffron-tint", text: "text-saffron-text" },
  { key: "fatG", label: "Fat g", tile: "bg-olive-tint", text: "text-olive-text" },
];

type Extra = "satFatMaxG" | "solubleFibreMinG" | "fibreMinG" | "sodiumMaxMg";

/** The automatic value of an optional target (null: no automatic value, e.g. sodium). */
export function autoExtra(extra: Extra, kcal: number, satFatPct: number): number | null {
  const fibre = Math.round((FIBRE_G_PER_1000_KCAL * kcal) / 1000);
  switch (extra) {
    case "satFatMaxG":
      return Math.round(((satFatPct / 100) * kcal) / 9);
    case "fibreMinG":
      return fibre;
    case "solubleFibreMinG":
      return Math.round(fibre * SOLUBLE_SHARE);
    case "sodiumMaxMg":
      return null;
  }
}

const EXTRA_LABEL: Readonly<Record<Extra, string>> = {
  satFatMaxG: "Sat fat max g",
  solubleFibreMinG: "Soluble fibre min g",
  fibreMinG: "Fibre min g",
  sodiumMaxMg: "Sodium max mg",
};

function toleranceIsDefault(t: Tolerance | undefined): boolean {
  return (
    t === undefined ||
    (t.proteinG === DEFAULT_TOLERANCE.proteinG &&
      t.carbsG === DEFAULT_TOLERANCE.carbsG &&
      t.fatG === DEFAULT_TOLERANCE.fatG &&
      t.kcal === DEFAULT_TOLERANCE.kcal &&
      t.mode === DEFAULT_TOLERANCE.mode)
  );
}

/** Your own values the given level hides (R2-DL-5). */
export function targetsHiddenAt(
  level: Level,
  rest: TargetProfile | undefined,
  training: TargetProfile | undefined,
  tolerance: Tolerance | undefined,
): number {
  let n = 0;
  const profiles = [rest, training].filter((p): p is TargetProfile => p !== undefined);
  if (levelRank(level) < 1) {
    if (training !== undefined) n += 1;
    for (const p of profiles)
      n += [p.satFatMaxG, p.solubleFibreMinG].filter((v) => v !== null).length;
  }
  if (levelRank(level) < 2) {
    for (const p of profiles) n += [p.fibreMinG, p.sodiumMaxMg].filter((v) => v !== null).length;
    if (!toleranceIsDefault(tolerance)) n += 1;
  }
  return n;
}

function profilePayload(
  p: TargetProfile,
  patch: Partial<Record<Macro | Extra, number | null>> = {},
) {
  return {
    kcal: p.kcal,
    proteinG: p.proteinG,
    carbsG: p.carbsG,
    fatG: p.fatG,
    satFatMaxG: p.satFatMaxG,
    solubleFibreMinG: p.solubleFibreMinG,
    fibreMinG: p.fibreMinG,
    sodiumMaxMg: p.sodiumMaxMg,
    ...patch,
  };
}

export function TargetsSection({
  data,
  member,
  onChanged,
  saved: savedByPage = false,
  onSaved,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onChanged: () => Promise<void>;
  /** W-22: set by the page, whose state outlives this section's re-creation after a save. */
  readonly saved?: boolean;
  readonly onSaved?: () => void;
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(member.id, "targets", levelOf(data, member.id, "targets"));
  const rest = data.targets.find((t) => t.memberId === member.id && t.kind === "default");
  const training = data.targets.find((t) => t.memberId === member.id && t.kind === "training");
  const tolerance = data.tolerances.find((t) => t.memberId === member.id);
  const [error, setError] = useState<string | null>(null);
  const [savedHere, setSaved] = useState(false);
  const saved = savedByPage || savedHere;
  const pct = data.household.satFatDefaultPct;
  const run = async (summary: string, ops: ChangeOp[]) => {
    try {
      await applyChanges(summary, ops);
      setError(null);
      setSaved(true);
      onSaved?.();
      await onChanged();
    } catch (e) {
      setError(problemText(e));
    }
  };
  const reset = async (to: Level) => {
    const ops: ChangeOp[] = [];
    const clear = (p: TargetProfile | undefined, kind: "default" | "training", extras: Extra[]) => {
      if (p === undefined || extras.every((x) => p[x] === null)) return;
      ops.push({
        kind: "target.set",
        payload: {
          memberId: member.id,
          kind,
          profile: profilePayload(p, Object.fromEntries(extras.map((x) => [x, null]))),
        },
      });
    };
    if (levelRank(to) < 1) {
      if (training !== undefined)
        ops.push({
          kind: "target.set",
          payload: { memberId: member.id, kind: "training", profile: null },
        });
      clear(rest, "default", ["satFatMaxG", "solubleFibreMinG", "fibreMinG", "sodiumMaxMg"]);
    } else {
      clear(rest, "default", ["fibreMinG", "sodiumMaxMg"]);
      clear(training, "training", ["fibreMinG", "sodiumMaxMg"]);
    }
    if (!toleranceIsDefault(tolerance))
      ops.push({ kind: "tolerance.set", payload: { memberId: member.id, ...DEFAULT_TOLERANCE } });
    if (ops.length > 0)
      await applyChanges(`Reset ${member.displayName}'s targets to automatic`, ops);
    await onChanged();
  };

  const control = member.isTargeted ? (
    <DetailControl
      scope={`${member.displayName}'s targets`}
      level={level}
      onLevel={change}
      hints={HINTS}
      hiddenAt={(l) => targetsHiddenAt(l, rest, training, tolerance)}
      onReset={reset}
      error={levelError}
    />
  ) : undefined;

  return (
    <Section id="targets" title="Daily targets" control={control}>
      {!member.isTargeted || rest === undefined ? (
        <UntargetedTargets member={member} onSave={run} />
      ) : (
        <>
          {levelRank(level) === 0 ? (
            <MacroTiles
              profile={rest}
              label="Every day"
              onSave={(p) =>
                run(`Set ${member.displayName}'s daily targets`, [
                  {
                    kind: "target.set",
                    payload: { memberId: member.id, kind: "default", profile: p },
                  },
                ])
              }
            />
          ) : (
            <TargetTable
              member={member}
              rest={rest}
              training={training}
              expert={levelRank(level) === 2}
              satFatPct={pct}
              onSave={run}
            />
          )}
          {levelRank(level) === 0 && training !== undefined && (
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              Training days: {training.kcal} kcal · P{training.proteinG} C{training.carbsG} F
              {training.fatG}
              <AutoTag state="hidden" editable={false} what="training-day targets" />
            </p>
          )}
          {levelRank(level) === 2 ? (
            <Precision member={member} tolerance={tolerance} onSave={run} />
          ) : (
            <p className="m-0 text-sm text-ink-soft">
              Each meal is held to protein ±{tolerance?.proteinG ?? DEFAULT_TOLERANCE.proteinG} g,
              carbs ±{tolerance?.carbsG ?? DEFAULT_TOLERANCE.carbsG} g, fat ±
              {tolerance?.fatG ?? DEFAULT_TOLERANCE.fatG} g; calories stay within ±
              {tolerance?.kcal ?? DEFAULT_TOLERANCE.kcal} per day
              {toleranceIsDefault(tolerance) ? " (household default)" : ""}.{" "}
              {levelRank(level) === 0 && (
                <>
                  <strong>Detailed</strong> adds training-day targets, saturated fat and soluble
                  fibre.
                </>
              )}
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <TellAssistant prompt={`Change ${member.displayName}'s daily targets: `} />
      </div>
    </Section>
  );
}

function MacroTiles({
  profile,
  label,
  onSave,
}: {
  readonly profile: TargetProfile;
  readonly label: string;
  readonly onSave: (p: ReturnType<typeof profilePayload>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<Macro, string>>({
    kcal: String(profile.kcal),
    proteinG: String(profile.proteinG),
    carbsG: String(profile.carbsG),
    fatG: String(profile.fatG),
  });
  const values = Object.fromEntries(MACROS.map((m) => [m.key, readNumber(draft[m.key])])) as Record<
    Macro,
    number | null
  >;
  const valid = MACROS.every((m) => {
    const v = values[m.key];
    return v !== null && Number.isFinite(v);
  });
  const dirty = MACROS.some((m) => values[m.key] !== profile[m.key]);
  return (
    <form
      aria-label={`${label} targets`}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void onSave(profilePayload(profile, values));
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MACROS.map((m) => (
          <label
            key={m.key}
            className={`flex min-w-0 flex-col gap-1 rounded-lg p-3.5 text-[13px] font-extrabold ${m.tile} ${m.text}`}
          >
            {m.label}
            <input
              inputMode="numeric"
              value={draft[m.key]}
              onChange={(e) => {
                setDraft({ ...draft, [m.key]: e.target.value });
              }}
              className="tabular w-full min-w-0 border-0 bg-transparent text-[26px] text-ink"
            />
          </label>
        ))}
      </div>
      {dirty && (
        <button
          type="submit"
          disabled={!valid}
          className="min-h-11 w-fit rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Save targets
        </button>
      )}
    </form>
  );
}

function TargetTable({
  member,
  rest,
  training,
  expert,
  satFatPct,
  onSave,
}: {
  readonly member: Member;
  readonly rest: TargetProfile;
  readonly training: TargetProfile | undefined;
  readonly expert: boolean;
  readonly satFatPct: number;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const extras: Extra[] = expert
    ? ["satFatMaxG", "solubleFibreMinG", "fibreMinG", "sodiumMaxMg"]
    : ["satFatMaxG", "solubleFibreMinG"];
  const rows: {
    kind: "default" | "training";
    label: string;
    profile: TargetProfile | undefined;
  }[] = [
    { kind: "default", label: "Rest days", profile: rest },
    { kind: "training", label: "Training days", profile: training },
  ];
  return (
    <div className="flex flex-col gap-3">
      {rows.map(({ kind, label, profile }) =>
        profile === undefined ? (
          <div key={kind} className="flex flex-wrap items-center gap-3 rounded-lg bg-paper p-3">
            <span className="font-extrabold">{label}</span>
            <span className="text-sm text-ink-soft">Same as rest days</span>
            <AutoTag state="auto" editable={false} what="training-day targets" />
            <button
              type="button"
              onClick={() =>
                void onSave(`Add ${member.displayName}'s training-day targets`, [
                  {
                    kind: "target.set",
                    payload: {
                      memberId: member.id,
                      kind: "training",
                      profile: profilePayload(rest),
                    },
                  },
                ])
              }
              className="min-h-11 rounded-md bg-flour px-3 text-sm font-extrabold text-ink"
            >
              Set different training-day numbers
            </button>
          </div>
        ) : (
          <ProfileRow
            key={kind}
            label={label}
            profile={profile}
            extras={extras}
            satFatPct={satFatPct}
            removable={kind === "training"}
            onSave={(patch) =>
              onSave(
                `Set ${member.displayName}'s ${kind === "training" ? "training-day" : "daily"} targets`,
                [
                  {
                    kind: "target.set",
                    payload: { memberId: member.id, kind, profile: profilePayload(profile, patch) },
                  },
                ],
              )
            }
            onRemove={() =>
              onSave(`Remove ${member.displayName}'s training-day targets`, [
                {
                  kind: "target.set",
                  payload: { memberId: member.id, kind: "training", profile: null },
                },
              ])
            }
          />
        ),
      )}
    </div>
  );
}

function ProfileRow({
  label,
  profile,
  extras,
  satFatPct,
  removable,
  onSave,
  onRemove,
}: {
  readonly label: string;
  readonly profile: TargetProfile;
  readonly extras: Extra[];
  readonly satFatPct: number;
  readonly removable: boolean;
  readonly onSave: (patch: Partial<Record<Macro | Extra, number | null>>) => Promise<void>;
  readonly onRemove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<Macro, string>>({
    kcal: String(profile.kcal),
    proteinG: String(profile.proteinG),
    carbsG: String(profile.carbsG),
    fatG: String(profile.fatG),
  });
  const [editing, setEditing] = useState<Extra | null>(null);
  const [extraDraft, setExtraDraft] = useState("");
  const values = Object.fromEntries(MACROS.map((m) => [m.key, readNumber(draft[m.key])])) as Record<
    Macro,
    number | null
  >;
  const valid = MACROS.every((m) => {
    const v = values[m.key];
    return v !== null && Number.isFinite(v);
  });
  const dirty = MACROS.some((m) => values[m.key] !== profile[m.key]);
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 rounded-lg border-0 bg-paper p-3"
      data-profile={label}
    >
      <legend className="float-left mb-1 font-extrabold">{label}</legend>
      <div className="clear-both grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MACROS.map((m) => (
          <label
            key={m.key}
            className={`flex min-w-0 flex-col gap-1 text-[13px] font-extrabold ${m.text}`}
          >
            {m.label}
            <input
              inputMode="numeric"
              value={draft[m.key]}
              onChange={(e) => {
                setDraft({ ...draft, [m.key]: e.target.value });
              }}
              className="tabular min-h-11 w-full min-w-0 rounded-md border-[1.5px] border-line-strong bg-card px-2.5 text-ink"
            />
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {extras.map((x) => {
          const own = profile[x];
          const auto = autoExtra(x, profile.kcal, satFatPct);
          const shown = own ?? auto;
          return (
            <div
              key={x}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md bg-card px-2.5 py-2"
              data-extra={x}
            >
              <span className="text-sm font-extrabold">{EXTRA_LABEL[x]}</span>
              {editing === x ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = readNumber(extraDraft);
                    if (n === null || !Number.isFinite(n)) return;
                    setEditing(null);
                    void onSave({ [x]: n });
                  }}
                >
                  <input
                    aria-label={EXTRA_LABEL[x]}
                    inputMode="numeric"
                    value={extraDraft}
                    onChange={(e) => {
                      setExtraDraft(e.target.value);
                    }}
                    className="tabular min-h-11 w-24 rounded-md border-[1.5px] border-line-strong px-2"
                  />
                  <button
                    type="submit"
                    className="min-h-11 rounded-md bg-action px-3 text-sm font-extrabold text-on-action"
                  >
                    Set
                  </button>
                </form>
              ) : (
                <span className="tabular">{shown === null ? "none" : String(shown)}</span>
              )}
              {editing !== x && (
                <AutoTag
                  state={own === null ? "auto" : "yours"}
                  editable
                  what={EXTRA_LABEL[x]}
                  onEdit={() => {
                    setExtraDraft(shown === null ? "" : String(shown));
                    setEditing(x);
                  }}
                  onBackToAuto={() => void onSave({ [x]: null })}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {dirty && (
          <button
            type="button"
            disabled={!valid}
            onClick={() => void onSave(values)}
            className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
          >
            Save {label.toLowerCase()}
          </button>
        )}
        {removable && (
          <button
            type="button"
            onClick={() => void onRemove()}
            className="min-h-11 rounded-md bg-flour px-3 text-sm font-extrabold text-ink"
          >
            Use rest-day numbers
          </button>
        )}
      </div>
    </fieldset>
  );
}

function Precision({
  member,
  tolerance,
  onSave,
}: {
  readonly member: Member;
  readonly tolerance: Tolerance | undefined;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const t = tolerance ?? { memberId: member.id, ...DEFAULT_TOLERANCE };
  const [draft, setDraft] = useState({
    proteinG: String(t.proteinG),
    carbsG: String(t.carbsG),
    fatG: String(t.fatG),
    kcal: String(t.kcal),
  });
  const isDefault = toleranceIsDefault(tolerance);
  const save = (patch: Partial<Tolerance>) =>
    onSave(`Change ${member.displayName}'s precision`, [
      { kind: "tolerance.set", payload: { memberId: member.id, ...patch } },
    ]);
  const fields = [
    { key: "proteinG", label: "P ± g per meal" },
    { key: "carbsG", label: "C ± g per meal" },
    { key: "fatG", label: "F ± g per meal" },
    { key: "kcal", label: "kcal ± per day" },
  ] as const;
  const parsed = Object.fromEntries(fields.map((f) => [f.key, readNumber(draft[f.key])]));
  const dirty = fields.some((f) => parsed[f.key] !== t[f.key]);
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-flour p-3" data-precision>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-extrabold">Precision</span>
        <AutoTag
          state={isDefault ? "auto" : "yours"}
          editable
          what="precision"
          onBackToAuto={() => void save({ ...DEFAULT_TOLERANCE })}
        />
        <div className="ml-auto" role="radiogroup" aria-label="Strict or flexible">
          {(["strict", "flexible"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={t.mode === mode}
              onClick={() => void save({ mode })}
              className={`min-h-11 rounded-md px-3 font-extrabold ${t.mode === mode ? "bg-ink text-paper" : "bg-card text-ink"}`}
            >
              {mode === "strict" ? "Strict" : "Flexible"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-[13px] font-extrabold">
            {f.label}
            <input
              inputMode="numeric"
              value={draft[f.key]}
              onChange={(e) => {
                setDraft({ ...draft, [f.key]: e.target.value });
              }}
              className="tabular min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2.5"
            />
          </label>
        ))}
      </div>
      {dirty && (
        <button
          type="button"
          onClick={() => {
            const patch: Partial<Tolerance> = {};
            for (const f of fields) {
              const v = parsed[f.key];
              if (v !== null && v !== undefined && Number.isFinite(v)) patch[f.key] = v;
            }
            void save(patch);
          }}
          className="min-h-11 w-fit rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Save precision
        </button>
      )}
      <p className="m-0 text-xs text-ink-soft">
        Protein, carbs and fat apply to every meal; calories to the whole day. Flexible lets a meal
        miss when no dish fits, and says by how much.
      </p>
    </div>
  );
}

function UntargetedTargets({
  member,
  onSave,
}: {
  readonly member: Member;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ kcal: "", proteinG: "", carbsG: "", fatG: "" });
  const values = Object.fromEntries(
    Object.entries(draft).map(([k, v]) => [k, readNumber(v)]),
  ) as Record<Macro, number | null>;
  const valid = MACROS.every((m) => {
    const v = values[m.key];
    return v !== null && Number.isFinite(v) && v > 0;
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-ink-soft">
        No targets. Portions come from appetite ({member.appetite}) and adjust from ratings.
      </p>
      {open ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            void onSave(`Give ${member.displayName} targets`, [
              { kind: "member.update", payload: { memberId: member.id, isTargeted: true } },
              {
                kind: "target.set",
                payload: {
                  memberId: member.id,
                  kind: "default",
                  profile: {
                    kcal: values.kcal ?? 0,
                    proteinG: values.proteinG ?? 0,
                    carbsG: values.carbsG ?? 0,
                    fatG: values.fatG ?? 0,
                  },
                },
              },
            ]);
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MACROS.map((m) => (
              <label
                key={m.key}
                className={`flex flex-col gap-1 rounded-lg p-3.5 text-[13px] font-extrabold ${m.tile} ${m.text}`}
              >
                {m.label}
                <input
                  inputMode="numeric"
                  value={draft[m.key]}
                  onChange={(e) => {
                    setDraft({ ...draft, [m.key]: e.target.value });
                  }}
                  className="tabular w-full border-0 bg-transparent text-[26px] text-ink"
                />
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={!valid}
            className="min-h-11 w-fit rounded-md bg-action px-4 font-extrabold text-on-action"
          >
            Save targets
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="min-h-11 w-fit rounded-md bg-flour px-4 font-extrabold text-ink"
        >
          Give {member.displayName} macro targets
        </button>
      )}
    </div>
  );
}
