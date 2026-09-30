"use client";
// Tastes for one member (UX-2 Taste; MemberSimple, MemberDetailed). Basic: liked / not-keen
// cuisines (the household's likes apply automatically). Detailed: this person's own cuisine
// likes. Expert: scores for ingredients, methods and dishes, locks, and frequency rules.
// Preferences use ingredient ids (R-36); learned values are shown as learned (FBK-4).
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { api, applyChanges, c, problemText } from "./api";
import { levelOf, type HouseholdData, type Member, type Preference } from "./data";
import { SaveStatus, Section } from "./parts";
import {
  AutoTag,
  DetailControl,
  TellAssistant,
  useDetailLevel,
} from "../detail-level/detail-control";
import { levelRank, type Level } from "../detail-level/logic";
import { Chip } from "../ui/chip";

const HINTS: Readonly<Record<Level, string>> = {
  basic:
    "Basic: the cuisines the household likes. Individual tastes are learned from ratings. Detailed adds this person's own cuisine likes.",
  detailed:
    "Detailed: set this person's own cuisine likes. Expert adds scores for ingredients, methods and dishes, locks and frequency rules.",
  expert:
    "Expert: every score the app uses for this person, where it came from, locks and frequency rules.",
};

export const LIKE = 0.5;
export const NOT_KEEN = -0.5;

export function cuisineLabel(data: HouseholdData, key: string): string {
  return data.cuisines.find((cu) => cu.key === key)?.label ?? key;
}

/** Explicit preference rows of a member, by entity type. */
function explicit(
  data: HouseholdData,
  memberId: string | null,
  types: readonly Preference["entityType"][],
) {
  return data.preferences.filter(
    (p) => p.memberId === memberId && p.source === "explicit" && types.includes(p.entityType),
  );
}

export function tastesHiddenAt(level: Level, data: HouseholdData, memberId: string): number {
  let n = 0;
  if (levelRank(level) < 1) n += explicit(data, memberId, ["cuisine"]).length;
  if (levelRank(level) < 2) {
    n += explicit(data, memberId, [
      "ingredient",
      "method",
      "dish",
      "flavour_tag",
      "component_role",
    ]).length;
    n += data.frequencyRules.filter(
      (r) => r.memberId === memberId && r.source === "explicit",
    ).length;
  }
  return n;
}

export function tastesResetOps(level: Level, data: HouseholdData, memberId: string): ChangeOp[] {
  const ops: ChangeOp[] = [];
  const types: Preference["entityType"][] = [
    "ingredient",
    "method",
    "dish",
    "flavour_tag",
    "component_role",
  ];
  if (levelRank(level) < 1) types.push("cuisine");
  for (const p of explicit(data, memberId, types))
    ops.push({
      kind: "preference.reset",
      payload: { memberId, entityType: p.entityType, entityKey: p.entityKey, source: "explicit" },
    });
  if (levelRank(level) < 2)
    for (const r of data.frequencyRules.filter(
      (x) => x.memberId === memberId && x.source === "explicit",
    ))
      ops.push({
        kind: "frequency.set",
        payload: {
          memberId,
          entityType: r.entityType,
          entityKey: r.entityKey,
          minGapDays: null,
          maxPerWeek: null,
          source: "explicit",
        },
      });
  return ops;
}

export function TastesSection({
  data,
  member,
  onChanged,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onChanged: () => Promise<void>;
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(member.id, "taste", levelOf(data, member.id, "taste"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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
  const household = data.preferences.filter(
    (p) => p.memberId === null && p.entityType === "cuisine",
  );
  const own = data.preferences.filter(
    (p) => p.memberId === member.id && p.entityType === "cuisine",
  );
  const ownKeys = new Set(own.map((p) => p.entityKey));
  const control = (
    <DetailControl
      scope={`${member.displayName}'s tastes`}
      level={level}
      onLevel={change}
      hints={HINTS}
      hiddenAt={(l) => tastesHiddenAt(l, data, member.id)}
      onReset={async (l) => {
        const ops = tastesResetOps(l, data, member.id);
        if (ops.length > 0)
          await applyChanges(`Reset ${member.displayName}'s tastes to automatic`, ops);
        await onChanged();
      }}
      error={levelError}
    />
  );
  const chips = [
    ...own.map((p) => ({
      key: p.entityKey,
      score: p.score,
      from: p.source === "learned" ? "learned" : "yours",
    })),
    ...household
      .filter((p) => !ownKeys.has(p.entityKey))
      .map((p) => ({ key: p.entityKey, score: p.score, from: "household" })),
  ].filter((x) => Math.abs(x.score) >= 0.2);
  return (
    <Section
      id="tastes"
      title={levelRank(level) === 2 ? "Tastes (detailed)" : "Tastes"}
      control={control}
    >
      {levelRank(level) === 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-tastes="basic">
          {chips.length === 0 && (
            <span className="text-sm text-ink-soft">Nothing yet: learned from ratings.</span>
          )}
          {chips.map((x) => (
            <Chip key={x.key} tone={x.score > 0 ? "basil" : "pomegranate"} size="sm">
              {x.score > 0 ? "" : "Not keen: "}
              {cuisineLabel(data, x.key)}
              {x.from === "household" ? " · household" : x.from === "learned" ? " · learned" : ""}
            </Chip>
          ))}
          {chips.some((x) => x.from === "household") && (
            <AutoTag state="auto" editable={false} what="household cuisines" />
          )}
        </div>
      )}
      {levelRank(level) >= 1 && <CuisineChoices data={data} member={member} onSave={run} />}
      {levelRank(level) === 2 && <ExpertTastes data={data} member={member} onSave={run} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <Link href="/family/tastes" className="text-sm font-extrabold">
          Family tastes
        </Link>
        <TellAssistant prompt={`Change ${member.displayName}'s tastes: `} />
      </div>
    </Section>
  );
}

function CuisineChoices({
  data,
  member,
  onSave,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const liked = new Set(
    data.preferences
      .filter((p) => p.memberId === null && p.entityType === "cuisine" && p.score > 0)
      .map((p) => p.entityKey),
  );
  const keys = [
    ...new Set([
      ...liked,
      ...data.preferences
        .filter((p) => p.memberId === member.id && p.entityType === "cuisine")
        .map((p) => p.entityKey),
      ...data.cuisines.slice(0, 12).map((cu) => cu.key),
    ]),
  ];
  return (
    <ul
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-1.5 p-0"
      data-tastes="detailed"
    >
      {keys.map((key) => {
        const mine = data.preferences.find(
          (p) =>
            p.memberId === member.id &&
            p.entityType === "cuisine" &&
            p.entityKey === key &&
            p.source === "explicit",
        );
        const learned = data.preferences.find(
          (p) =>
            p.memberId === member.id &&
            p.entityType === "cuisine" &&
            p.entityKey === key &&
            p.source === "learned",
        );
        const state = mine === undefined ? "auto" : mine.score > 0 ? "like" : "not";
        const set = (score: number | null) =>
          onSave(
            `${member.displayName}: ${cuisineLabel(data, key)}`,
            score === null
              ? [
                  {
                    kind: "preference.reset",
                    payload: {
                      memberId: member.id,
                      entityType: "cuisine",
                      entityKey: key,
                      source: "explicit",
                    },
                  },
                ]
              : [
                  {
                    kind: "preference.set",
                    payload: {
                      memberId: member.id,
                      entityType: "cuisine",
                      entityKey: key,
                      score,
                      source: "explicit",
                    },
                  },
                ],
          );
        return (
          <li
            key={key}
            className="flex flex-wrap items-center gap-1.5 rounded-md bg-paper px-2.5 py-1.5"
            data-cuisine={key}
          >
            <span className="grow font-extrabold">{cuisineLabel(data, key)}</span>
            {learned !== undefined && (
              <span className="text-xs text-ink-soft">
                learned {learned.score > 0 ? "+" : ""}
                {learned.score.toFixed(1)}
              </span>
            )}
            <div
              role="radiogroup"
              aria-label={`${member.displayName} and ${cuisineLabel(data, key)}`}
              className="flex flex-wrap gap-1"
            >
              {(
                [
                  ["like", "Likes", LIKE],
                  ["auto", liked.has(key) ? "Household" : "Neutral", null],
                  ["not", "Not keen", NOT_KEEN],
                ] as const
              ).map(([value, label, score]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={state === value}
                  onClick={() => void set(score)}
                  className={`min-h-11 rounded-md px-2 text-xs font-extrabold ${state === value ? "bg-ink text-paper" : "bg-flour text-ink-soft"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ExpertTastes({
  data,
  member,
  onSave,
}: {
  readonly data: HouseholdData;
  readonly member: Member;
  readonly onSave: (summary: string, ops: ChangeOp[]) => Promise<void>;
}) {
  const [dishes, setDishes] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void api
      .call(c.dishesList, { query: {} })
      .then((r) => {
        setDishes(new Map((r.dishes ?? []).map((d) => [d.id, d.name])));
      })
      .catch(() => undefined);
  }, []);
  const rows = data.preferences.filter(
    (p) => p.memberId === member.id && p.entityType !== "cuisine",
  );
  const name = (p: Preference) =>
    p.entityType === "ingredient"
      ? (data.ingredients.find((i) => i.id === p.entityKey)?.name ?? p.entityKey)
      : p.entityType === "dish"
        ? (dishes.get(p.entityKey) ?? "a dish")
        : p.entityKey.replace(/_/g, "-");
  const rules = data.frequencyRules.filter((r) => r.memberId === member.id || r.memberId === null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="text-lg">Scores</h3>
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">
            None yet: scores appear as {member.displayName} rates meals.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{name(p)}</strong> {p.entityType.replace("_", " ")}
                </span>
                <span
                  className={`font-extrabold ${p.score < 0 ? "text-pomegranate-text" : "text-basil-text"}`}
                >
                  {p.score > 0 ? "+" : "−"}
                  {Math.abs(p.score).toFixed(1)} {p.source === "learned" ? "learned" : "set"}
                  {p.locked ? " · locked" : ""}
                </span>
                {p.source === "explicit" && (
                  <button
                    type="button"
                    onClick={() =>
                      void onSave(`${p.locked ? "Unlock" : "Lock"} ${name(p)}`, [
                        {
                          kind: "preference.set",
                          payload: {
                            memberId: member.id,
                            entityType: p.entityType,
                            entityKey: p.entityKey,
                            score: p.score,
                            source: "explicit",
                            locked: !p.locked,
                          },
                        },
                      ])
                    }
                    className="min-h-11 rounded-md bg-flour px-2 text-xs font-extrabold text-ink"
                  >
                    {p.locked ? "Unlock" : "Lock"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg">Frequency rules</h3>
        {rules.length === 0 ? (
          <p className="m-0 text-sm text-ink-soft">
            None. The same dish is not repeated within the planning window.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {rules.map((r) => (
              <li key={r.id}>
                {r.entityType === "ingredient"
                  ? (data.ingredients.find((i) => i.id === r.entityKey)?.name ?? r.entityKey)
                  : r.entityType === "dish"
                    ? (dishes.get(r.entityKey) ?? "A dish")
                    : r.entityKey}
                {r.maxPerWeek !== null && (
                  <>
                    : at most <strong>{r.maxPerWeek} a week</strong>
                  </>
                )}
                {r.minGapDays !== null && (
                  <>
                    {r.maxPerWeek !== null ? "," : ":"} no repeat within{" "}
                    <strong>{r.minGapDays} days</strong>
                  </>
                )}
                {r.memberId === null ? " (household)" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
