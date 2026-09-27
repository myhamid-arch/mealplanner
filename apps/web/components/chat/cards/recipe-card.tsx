"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { changeSetsApply } from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../admin/api";
import { FormError } from "../../admin/field";
import { DishThumb } from "../../reviews/dish-thumb";
import { Button } from "../../ui/button";
import { useChatData } from "../context";
import type { Description } from "../describe";
import type { Json } from "../proposals";
import { AppliedBody } from "./applied-change-card";
import { FitBadge } from "./fit";
import type { DraftDish, RecipeCard as Card } from "./parse";

type Op = DraftDish["ops"][number];

const DISCARDED_KEY = "mise.chat.discardedDrafts";

function readDiscarded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISCARDED_KEY);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeDiscarded(keys: Set<string>): void {
  try {
    window.localStorage.setItem(DISCARDED_KEY, JSON.stringify([...keys].slice(-200)));
  } catch {
    // Private mode or full storage: the discard lasts for this page only.
  }
}

/** The new dish's id: the `dish.create` op's pre-assigned id (R-53 ops carry ids). */
export function draftDishId(ops: readonly Op[]): string | null {
  const create = ops.find((o) => o.kind === "dish.create");
  const id = create?.payload.id;
  return typeof id === "string" ? id : null;
}

/**
 * The ops of a draft saved after another draft of the same card: an ingredient the earlier save
 * already created (same slug) is not created again, and the dish points at the existing one.
 */
export function remapOps(ops: readonly Op[], created: ReadonlyMap<string, string>): Op[] {
  const replace = new Map<string, string>();
  const kept: Op[] = [];
  for (const op of ops) {
    const slug = op.payload.slug;
    const id = op.payload.id;
    if (op.kind === "ingredient.create" && typeof slug === "string" && typeof id === "string") {
      const existing = created.get(slug);
      if (existing !== undefined) {
        replace.set(id, existing);
        continue;
      }
    }
    kept.push(op);
  }
  if (replace.size === 0) return kept;
  const swap = (v: Json): Json => {
    if (typeof v === "string") return replace.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (typeof v === "object" && v !== null)
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return kept.map((op) => ({ kind: op.kind, payload: swap(op.payload) as Op["payload"] }));
}

const words = (s: string) => s.replace(/_/g, " ");

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });

/**
 * "Use for Wed dinner" (ChatSidePanel; leaf 1.4.9, R-61): a saved draft's link to its recipe page
 * with the day and slot the request named (1.4.8's `?date=&slot=`, SPEC-Q-5). Null without both.
 */
export function recipeUseLink(
  dishId: string | null,
  use: Card["use"],
): { href: string; label: string } | null {
  if (dishId === null || use === undefined) return null;
  const day = new Date(`${use.date}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return null;
  const query = new URLSearchParams({ date: use.date, slot: use.slotKey });
  return {
    href: `/recipes/${dishId}?${query.toString()}`,
    label: `Use for ${WEEKDAY.format(day)} ${use.slotLabel.toLowerCase()}`,
  };
}

function DraftView({
  draft,
  draftKey,
  created,
  onCreated,
  use,
}: {
  readonly draft: DraftDish;
  readonly draftKey: string;
  readonly created: ReadonlyMap<string, string>;
  readonly onCreated: (slugs: [string, string][]) => void;
  readonly use: Card["use"];
}) {
  const { dishIds, refresh, prefill } = useChatData();
  const dishId = draftDishId(draft.ops);
  const [saved, setSaved] = useState<{ changeSetId: string; descriptions: Description[] } | null>(
    null,
  );
  const [discarded, setDiscarded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = draft.dish;
  const already = saved === null && dishId !== null && dishIds.has(dishId);
  const useFor = recipeUseLink(dishId, use);

  useEffect(() => {
    setDiscarded(readDiscarded().has(draftKey));
  }, [draftKey]);

  if (discarded)
    return (
      <div className="flex items-center gap-2 rounded-card bg-flour px-3.5 py-3 text-sm font-bold text-ink-soft">
        Discarded “{d.name}”.
        <button
          type="button"
          className="min-h-11 rounded-md px-2 font-extrabold text-action"
          onClick={() => {
            const keys = readDiscarded();
            keys.delete(draftKey);
            writeDiscarded(keys);
            setDiscarded(false);
          }}
        >
          Show again
        </button>
      </div>
    );

  const time = Math.max(0, ...d.components.flatMap((c) => c.variants.map((v) => v.cookTimeMin)));
  const cuisines = [d.cuisine, d.secondaryCuisine].filter((c): c is string => c !== undefined);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const applied = await api.call(changeSetsApply, {
        body: { summary: draft.summary, ops: remapOps(draft.ops, created) },
      });
      onCreated(
        draft.ops.flatMap((o) =>
          o.kind === "ingredient.create" &&
          typeof o.payload.slug === "string" &&
          typeof o.payload.id === "string"
            ? [[o.payload.slug, created.get(o.payload.slug) ?? o.payload.id] as [string, string]]
            : [],
        ),
      );
      setSaved({ changeSetId: applied.changeSetId, descriptions: applied.descriptions });
      await refresh();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="overflow-hidden rounded-xl border-[1.5px] border-line-strong bg-card"
      data-draft={draftKey}
    >
      {dishId !== null && <DishThumb id={dishId} size={90} banner />}
      <div className="flex flex-col gap-2.5 p-3.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-xl font-bold">{d.name}</span>
          <span className="rounded-full bg-aubergine-tint px-2 py-0.5 text-[11px] font-extrabold text-aubergine-text">
            NEW
          </span>
        </span>
        <span className="text-[13px] text-ink-soft">
          {cuisines.map(words).join(" · ")} · {d.slotKeys.map(words).join(", ")}
          {time > 0 && ` · ${String(time)} min`}
        </span>
        {d.description !== "" && <span className="text-sm">{d.description}</span>}
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
          {d.components.map((c) => (
            <li key={c.name}>
              <strong>{c.name}:</strong> {c.variants.map((v) => v.label.toLowerCase()).join(" · ")}
            </li>
          ))}
        </ul>
        {draft.plates.length > 0 && (
          <div className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)_max-content] items-center gap-x-2 gap-y-1 rounded-card bg-paper p-2.5 text-xs">
            {draft.plates.map((p) => (
              <div key={p.label} className="contents">
                <span className="font-extrabold">{p.member}</span>
                <span>{p.explain[0] ?? ""}</span>
                <FitBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
        {draft.newIngredients.length > 0 && (
          <span className="text-xs text-ink-soft">
            New {draft.newIngredients.length === 1 ? "ingredient" : "ingredients"} (estimated
            nutrition, to verify): {draft.newIngredients.map((n) => n.name).join(", ")}.
          </span>
        )}
        {!draft.candidate && draft.reasons.length > 0 && (
          <span className="text-xs text-pomegranate-text">
            Not every target fits: {draft.reasons.map((r) => r.message).join("; ")}
          </span>
        )}
        {saved !== null ? (
          <div className="flex flex-col gap-2">
            <AppliedBody
              changeSetId={saved.changeSetId}
              descriptions={[]}
              badge="SAVED TO RECIPES"
            />
            {dishId !== null && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {useFor !== null && (
                  <Link href={useFor.href} className="text-sm font-extrabold">
                    {useFor.label}
                  </Link>
                )}
                <Link href={`/recipes/${dishId}`} className="text-sm font-extrabold">
                  Open recipe
                </Link>
              </div>
            )}
          </div>
        ) : already ? (
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-basil-text">
            <span>
              Saved to recipes. <Link href={`/recipes/${dishId}`}>Open recipe</Link>
            </span>
            {useFor !== null && (
              <Link href={useFor.href} className="font-extrabold">
                {useFor.label}
              </Link>
            )}
          </span>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              className="grow"
              loading={busy}
              onClick={() => void save()}
              aria-label={`Save “${d.name}” to recipes`}
            >
              Save to recipes
            </Button>
            <Button
              variant="secondary"
              className="grow border-[1.5px] border-ink bg-card"
              disabled={busy}
              aria-label={`Discard “${d.name}”`}
              onClick={() => {
                const keys = readDiscarded();
                keys.add(draftKey);
                writeDiscarded(keys);
                setDiscarded(true);
              }}
            >
              Discard
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                prefill(`Another idea like “${d.name}”, but `);
              }}
            >
              Another
            </Button>
          </div>
        )}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

/** AGT-7 `recipe` (R-46, ChatPhoneRecipe): drafts with per-attendee plates, Save / Discard. */
export function RecipeCardView({ card }: { readonly card: Card }) {
  const [created, setCreated] = useState(new Map<string, string>());
  return (
    <div className="flex flex-col gap-3" data-card="recipe">
      {card.dishes.map((draft, i) => (
        <DraftView
          key={`${card.jobId}-${String(i)}`}
          draft={draft}
          draftKey={`${card.jobId}:${String(i)}`}
          created={created}
          onCreated={(pairs) => {
            setCreated((m) => new Map([...m, ...pairs]));
          }}
          use={card.use}
        />
      ))}
      {card.dishes.length === 0 && card.rejected.length === 0 && (
        <span className="text-sm text-ink-soft">No recipe came back this time.</span>
      )}
      {card.rejected.length > 0 && (
        <details className="rounded-card bg-flour px-3.5 py-2.5 text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-extrabold">
            {card.rejected.length} {card.rejected.length === 1 ? "idea" : "ideas"} didn't pass the
            checks
          </summary>
          <ul className="m-0 mt-1 flex flex-col gap-1 pl-5">
            {card.rejected.map((r, i) => (
              <li key={`${r.dishName}-${String(i)}`}>
                <strong>{r.dishName}</strong>: {r.reasons.map((x) => x.message).join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
