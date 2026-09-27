"use client";
// My tastes (TastePhone.dc.html; the Me tab, R-21 Q-3; leaf-1.4.3 SPEC-Q-14): a taste swipe over
// 20 dishes (Not for me / It's fine / Love it → this member's own dish preference, PUT /preferences,
// ARC-6 "edit own taste preferences") and what has been learned from their reviews. On phones,
// admins also reach Family, Insights, Settings and People & access from here (R-21 Q-2).
import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";
import { api, c, problemText, useLoad } from "./api";
import { ErrorBlock, LoadingBlock } from "./parts";
import { Icon, type IconName } from "../ui/icon";

type Dish = z.output<typeof c.DishSummaryDto>;
const SWIPE_SIZE = 20;

async function load() {
  const me = await api.call(c.me, {});
  const membership = me.memberships.find((m) => m.status === "active") ?? null;
  const memberId = membership?.memberId ?? null;
  const [prefs, dishes, cuisines, ingredients] = await Promise.all([
    memberId === null
      ? Promise.resolve({ preferences: [] })
      : api.call(c.preferencesList, { query: { memberId } }),
    api.call(c.dishesList, { query: { status: "active" } }),
    api.call(c.cuisinesList, {}),
    api.call(c.ingredientsList, { query: { limit: 500 } }),
  ]);
  return {
    name: me.user.name,
    role: membership?.role ?? null,
    memberId,
    preferences: prefs.preferences.filter((p) => p.memberId === memberId),
    dishes: (dishes.dishes ?? [])
      .filter((d) => !d.isAdjuster)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, SWIPE_SIZE),
    allDishes: new Map((dishes.dishes ?? []).map((d) => [d.id, d.name])),
    cuisines: new Map((cuisines.cuisines ?? []).map((cu) => [cu.key, cu.label])),
    ingredients: new Map((ingredients.ingredients ?? []).map((i) => [i.id, i.name])),
  };
}

const ADMIN_LINKS: readonly { href: string; label: string; icon: IconName }[] = [
  { href: "/family", label: "Family", icon: "family" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/access", label: "People & access", icon: "access" },
];

export function MyTastes() {
  const { data, error, loading, reload } = useLoad(load);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (data === null)
    return error === null || loading ? (
      <LoadingBlock label="Loading your tastes" />
    ) : (
      <ErrorBlock message={error} onRetry={() => void reload()} />
    );
  const rated = new Set(
    data.preferences
      .filter((p) => p.entityType === "dish" && p.source === "explicit")
      .map((p) => p.entityKey),
  );
  const done = data.dishes.filter((d) => rated.has(d.id)).length;
  const current: Dish | undefined = data.dishes.find((d) => !rated.has(d.id));
  const rate = async (dish: Dish, score: number) => {
    if (data.memberId === null) return;
    setBusy(true);
    try {
      await api.call(c.preferencesSet, {
        body: {
          memberId: data.memberId,
          entityType: "dish",
          entityKey: dish.id,
          score,
          locked: false,
          hard: "none",
        },
      });
      setFailure(null);
      await reload();
    } catch (e) {
      setFailure(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  const learned = data.preferences
    .filter((p) => p.source === "learned" && p.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((p) =>
      p.entityType === "cuisine"
        ? (data.cuisines.get(p.entityKey) ?? p.entityKey)
        : p.entityType === "ingredient"
          ? (data.ingredients.get(p.entityKey) ?? p.entityKey)
          : p.entityType === "dish"
            ? (data.allDishes.get(p.entityKey) ?? "A dish")
            : p.entityKey.replace(/_/g, " "),
    );
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[30px]">My tastes</h1>
        <span className="font-extrabold text-ink-soft">{data.name}</span>
      </div>
      {data.memberId === null ? (
        <p className="m-0 rounded-2xl bg-card p-4 shadow-card">
          Your login is not linked to anyone in the family yet, so there are no tastes to set. An
          admin can link it in People &amp; access.
        </p>
      ) : (
        <section aria-labelledby="swipe-title" className="flex flex-col gap-3">
          <div className="flex justify-between font-extrabold">
            <h2 id="swipe-title" className="font-body text-base">
              Taste swipe
            </h2>
            <span data-swipe-progress>
              {done} of {data.dishes.length}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Taste swipe progress"
            aria-valuemin={0}
            aria-valuemax={data.dishes.length}
            aria-valuenow={done}
            className="h-2 overflow-hidden rounded-full bg-flour"
          >
            <div
              className="h-full bg-action"
              style={{
                width: `${String(data.dishes.length === 0 ? 0 : (done / data.dishes.length) * 100)}%`,
              }}
            />
          </div>
          {current === undefined ? (
            <p className="m-0 rounded-2xl bg-basil-tint p-4 font-extrabold text-basil-text">
              All done. Thank you: the next plans use your answers.
            </p>
          ) : (
            <>
              <article
                className="flex flex-col gap-2 rounded-2xl bg-card p-5 shadow-card"
                data-swipe-dish={current.slug}
              >
                <span className="w-fit rounded-full bg-saffron-tint px-3 py-1 text-sm font-extrabold text-saffron-text">
                  {data.cuisines.get(current.cuisineKey) ?? current.cuisineKey}
                </span>
                <h3 className="text-2xl">{current.name}</h3>
                <p className="m-0 text-ink-soft">{current.description}</p>
              </article>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Not for me", -0.5, "bg-pomegranate-tint text-pomegranate-text"],
                    ["It's fine", 0, "bg-flour text-ink"],
                    ["Love it", 0.5, "bg-basil-tint text-basil-text"],
                  ] as const
                ).map(([label, score, cls]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={busy}
                    onClick={() => void rate(current, score)}
                    className={`min-h-12 rounded-lg font-extrabold ${cls}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {failure !== null && (
            <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
              {failure}
            </p>
          )}
        </section>
      )}
      <section aria-labelledby="learned-title" className="flex flex-col gap-2">
        <h2 id="learned-title" className="font-body text-base font-extrabold">
          Learned from your reviews
        </h2>
        <div className="flex flex-wrap gap-2">
          {learned.length === 0 ? (
            <span className="text-sm text-ink-soft">
              Nothing yet. Rate a few meals and it shows here.
            </span>
          ) : (
            learned.map((l) => (
              <span
                key={l}
                className="rounded-full bg-basil-tint px-3 py-1 text-sm font-extrabold text-basil-text"
              >
                {l}
              </span>
            ))
          )}
          <Link href="/insights" className="self-center text-sm font-extrabold">
            See all
          </Link>
        </div>
      </section>
      <nav aria-label="More" className="flex flex-col gap-2 lg:hidden">
        {(data.role === "admin" ? ADMIN_LINKS : []).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex min-h-12 items-center gap-3 rounded-xl bg-card px-4 font-extrabold text-ink no-underline shadow-card"
          >
            <Icon name={l.icon} size={20} />
            {l.label}
          </Link>
        ))}
        <Link
          href="/account"
          className="flex min-h-12 items-center gap-3 rounded-xl bg-card px-4 font-extrabold text-ink no-underline shadow-card"
        >
          <Icon name="me" size={20} />
          Account
        </Link>
      </nav>
    </div>
  );
}
