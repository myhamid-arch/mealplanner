"use client";
// Allergies & never-serve (R2-ONB-3, DM-5). Every exclusion is a filter, whatever its `hard` flag
// (R-34): nothing on this list is ever planned for the person. `hard` only means the rule is
// protected, so the copy never suggests a soft rule may still be served. Foods are stored as
// ingredient slugs, allergens and household rules as dietary flags (R-36).
import { useState } from "react";
import { resolveTerm } from "@mealplanner/core/onboarding";
import type { ChangeOp } from "@mealplanner/core/changes";
import { applyChanges, problemText } from "./api";
import type { Exclusion, HouseholdData, Member } from "./data";
import { SaveStatus } from "./parts";

export const FLAG_LABEL: Readonly<Record<string, string>> = {
  contains_nuts: "nuts",
  contains_gluten: "gluten",
  contains_dairy: "dairy",
  contains_egg: "egg",
  contains_fish: "fish",
  contains_shellfish: "shellfish",
  contains_soy: "soy",
  contains_sesame: "sesame",
  contains_pork: "pork",
  contains_alcohol: "alcohol",
};

const REASON_LABEL: Readonly<Record<Exclusion["reason"], string>> = {
  allergy: "ALLERGY",
  religious: "household rule",
  medical: "medical",
  dislike: "dislike",
  other: "never serve",
};

/** "sesame", "beef liver", "fish". */
export function exclusionWhat(e: Exclusion, data: HouseholdData): string {
  if (e.kind === "dietary_flag") return FLAG_LABEL[e.key] ?? e.key.replace(/^contains_/, "");
  if (e.kind === "ingredient")
    return (data.ingredients.find((i) => i.slug === e.key)?.name ?? e.key).toLowerCase();
  return e.key.replace(/_/g, " ");
}

/** For a flag: a few covered foods ("incl. tahini, hummus"). */
function including(e: Exclusion, data: HouseholdData): string {
  if (e.kind !== "dietary_flag") return "";
  const names = data.ingredients
    .filter((i) => i.dietaryFlags.includes(e.key))
    .map((i) => i.name.toLowerCase())
    .filter((n) => !n.includes(exclusionWhat(e, data)));
  if (names.length === 0) return "";
  return ` (incl. ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""})`;
}

function isProtected(e: Exclusion): boolean {
  return e.reason === "allergy" || (e.hard && (e.reason === "medical" || e.reason === "religious"));
}

/**
 * 1.2.6 (R-62), OQ-9: a slot-scoped rule's scope, "in the packed school lunch only"; empty for a
 * rule that applies to every meal.
 */
export function exclusionScope(e: Exclusion, data: HouseholdData): string {
  if (e.slotKeys == null) return "";
  const labels = e.slotKeys.map(
    (k) => data.slots.find((s) => s.key === k)?.label.toLowerCase() ?? k.replace(/_/g, " "),
  );
  const joined =
    labels.length <= 1
      ? (labels[0] ?? "")
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
  return `in the ${joined} only`;
}

/**
 * Groups rows of one person, reason and slot scope into one line: "Sara · liver, kidneys —
 * dislike"; a scoped group reads "Layla · nuts · in the packed school lunch only".
 */
function lines(rows: readonly Exclusion[], data: HouseholdData, names: Map<string, string>) {
  const groups = new Map<string, Exclusion[]>();
  const scopeOf = (e: Exclusion) => (e.slotKeys == null ? "" : `|${e.slotKeys.join(",")}`);
  for (const e of rows) {
    const key = `${e.memberId ?? "*"}|${e.reason}${scopeOf(e)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, group]) => {
    const head = group[0] as Exclusion;
    const who = head.memberId === null ? "Everyone" : (names.get(head.memberId) ?? "Someone");
    const what = [...new Set(group.map((e) => exclusionWhat(e, data)))].join(", ");
    const incl = group.length === 1 ? including(head, data) : "";
    return {
      key,
      who,
      what: `${what}${incl}`,
      scope: exclusionScope(head, data),
      head,
      group,
    };
  });
}

export function NeverServeList({
  data,
  member,
  onChanged,
  showHousehold = true,
}: {
  readonly data: HouseholdData;
  /** Only this member's rows (plus household rules when `showHousehold`); all rows when absent. */
  readonly member?: Member;
  readonly onChanged: () => Promise<void>;
  readonly showHousehold?: boolean;
}) {
  const names = new Map(data.members.map((m) => [m.id, m.displayName]));
  const rows = data.exclusions.filter(
    (e) =>
      member === undefined || e.memberId === member.id || (showHousehold && e.memberId === null),
  );
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const remove = async (group: readonly Exclusion[], label: string) => {
    const protectedRule = group.some(isProtected);
    if (
      protectedRule &&
      !window.confirm(
        `Remove "${label}"? It is a protected rule; after this it can be planned again.`,
      )
    )
      return;
    try {
      await applyChanges(
        `Remove never-serve rule: ${label}`,
        group.map((e) => ({ kind: "exclusion.remove", payload: { exclusionId: e.id } })),
      );
      setError(null);
      setSaved(true);
      await onChanged();
    } catch (e) {
      setError(problemText(e));
    }
  };
  return (
    <div className="flex flex-col gap-2.5">
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-soft">
          None. Allergies are hard rules: nothing containing them is ever planned
          {member === undefined ? "" : ` for ${member.displayName}`}.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lines(rows, data, names).map((line) => (
            <li
              key={line.key}
              data-never-serve={`${line.who}|${line.head.reason}${
                line.head.slotKeys == null ? "" : `|${line.head.slotKeys.join(",")}`
              }`}
              className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 ${
                line.head.reason === "allergy"
                  ? "bg-pomegranate-tint text-pomegranate-text"
                  : "bg-flour text-ink"
              }`}
            >
              <span className="grow font-extrabold">
                {line.who} · {line.what}
                {line.scope === "" ? null : (
                  <span className="font-semibold text-ink-soft"> · {line.scope}</span>
                )}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                  line.head.reason === "allergy"
                    ? "bg-pomegranate-text text-paper"
                    : "text-ink-soft"
                }`}
              >
                {REASON_LABEL[line.head.reason]}
              </span>
              <button
                type="button"
                onClick={() =>
                  void remove(
                    line.group,
                    `${line.who} · ${line.what}${line.scope === "" ? "" : ` · ${line.scope}`}`,
                  )
                }
                className="min-h-11 rounded-md px-2 text-sm font-extrabold underline"
                aria-label={`Remove ${line.who} · ${line.what}${
                  line.scope === "" ? "" : ` · ${line.scope}`
                }`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-xs text-ink-soft">
        Never planned, including in sauces and marinades. Allergies and household rules are
        protected: only an admin removes them.
      </p>
      {adding ? (
        <NeverServeForm
          data={data}
          {...(member === undefined ? {} : { member })}
          onDone={async (didSave) => {
            setAdding(false);
            if (didSave) {
              setSaved(true);
              await onChanged();
            }
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
          }}
          className="min-h-11 w-fit rounded-md border-[1.5px] border-dashed border-action px-4 font-extrabold text-action"
        >
          {member === undefined ? "Add a rule" : "Add"}
        </button>
      )}
      <SaveStatus error={error} saved={saved} />
    </div>
  );
}

function NeverServeForm({
  data,
  member,
  onDone,
}: {
  readonly data: HouseholdData;
  readonly member?: Member;
  readonly onDone: (saved: boolean) => Promise<void>;
}) {
  const [who, setWho] = useState<string>(member?.id ?? "*");
  const [food, setFood] = useState("");
  const [reason, setReason] = useState<Exclusion["reason"]>("allergy");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ingredients = data.ingredients.map((i) => ({
    slug: i.slug,
    name: i.name,
    aliases: i.aliases,
    dietaryFlags: i.dietaryFlags,
  }));
  const resolution = food.trim() === "" ? null : resolveTerm(food, ingredients);
  const preview =
    resolution === null
      ? ""
      : resolution.kind === "dietary_flag"
        ? `Everything flagged ${FLAG_LABEL[resolution.flag] ?? resolution.flag}: ${String(resolution.slugs.length)} foods in the catalogue.`
        : resolution.kind === "ingredient"
          ? `Matches ${resolution.slugs.map((s) => data.ingredients.find((i) => i.slug === s)?.name ?? s).join(", ")}.`
          : "Not in the catalogue. Try another word (for example “sesame”, “nuts”, “liver”).";
  const save = async () => {
    if (resolution === null || resolution.kind === "unknown") {
      setError("Name a food or allergen the catalogue knows.");
      return;
    }
    const memberId = who === "*" ? null : who;
    const hard = reason !== "dislike";
    const ops: ChangeOp[] =
      resolution.kind === "dietary_flag"
        ? [
            {
              kind: "exclusion.add",
              payload: { memberId, kind: "dietary_flag", key: resolution.flag, reason, hard },
            },
          ]
        : resolution.slugs.map((slug) => ({
            kind: "exclusion.add",
            payload: { memberId, kind: "ingredient", key: slug, reason, hard },
          }));
    setBusy(true);
    try {
      await applyChanges(`Never serve ${food.trim()}`, ops);
      await onDone(true);
    } catch (e) {
      setError(problemText(e));
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-lg bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-extrabold">
          Who
          <select
            value={who}
            onChange={(e) => {
              setWho(e.target.value);
            }}
            className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
          >
            <option value="*">Everyone</option>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-extrabold">
          Food or allergen
          <input
            value={food}
            onChange={(e) => {
              setFood(e.target.value);
            }}
            className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-extrabold">
          Why
          <select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as Exclusion["reason"]);
            }}
            className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-2 font-normal"
          >
            <option value="allergy">Allergy</option>
            <option value="religious">Religious rule</option>
            <option value="medical">Medical</option>
            <option value="dislike">Dislike</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <p className="m-0 text-sm text-ink-soft" aria-live="polite">
        {preview}
      </p>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-md bg-action px-4 font-extrabold text-on-action"
        >
          Save rule
        </button>
        <button
          type="button"
          onClick={() => void onDone(false)}
          className="min-h-11 rounded-md bg-flour px-4 font-extrabold text-ink"
        >
          Cancel
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </form>
  );
}
