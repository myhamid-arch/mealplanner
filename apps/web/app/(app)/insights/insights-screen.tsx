"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  accessList,
  changeSetsList,
  changeSetsPreview,
  cuisinesList,
  dishesGet,
  ingredientsGet,
  methodsList,
  portionBiasesList,
  preferencesList,
  preferencesReset,
  preferencesSet,
  proposalsList,
  reviewsList,
  type PortionBiasDto,
  type PreferenceDto,
} from "@mealplanner/api-contract/contract";
import type { z } from "zod";
import { api, problemMessage } from "../../../components/admin/api";
import { FormError } from "../../../components/admin/field";
import { LoadError } from "../../../components/admin/load-error";
import { useLoad } from "../../../components/admin/use-load";
import type { Description } from "../../../components/chat/describe";
import { ChangeDiff } from "../../../components/chat/diff";
import { loadNames, type Names } from "../../../components/chat/names";
import { ProposalActions } from "../../../components/chat/proposal-actions";
import {
  evidenceText,
  PROPOSAL_BUDGET,
  PROPOSAL_EXPIRY_DAYS,
  proposalOps,
  proposalTitle,
  type Proposal,
} from "../../../components/chat/proposals";
import { loadViewer, type Viewer } from "../../../components/reviews/viewer";
import { Button, buttonClasses } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { SkeletonBlock } from "../../../components/ui/skeleton";

type Preference = z.output<typeof PreferenceDto>;
type Bias = z.output<typeof PortionBiasDto>;

const ROLE_LABELS: Readonly<Record<string, string>> = {
  protein: "Protein",
  carb: "Carbs",
  vegetable: "Veg",
  sauce: "Sauce",
  fat: "Fat",
  garnish: "Garnish",
  side: "Sides",
  drink: "Drinks",
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  dish: "dish",
  variant: "variant",
  ingredient: "ingredient",
  cuisine: "cuisine",
  method: "method",
  flavour_tag: "flavour",
  component_role: "part",
};

interface Data {
  viewer: Viewer;
  preferences: Preference[];
  biases: Bias[];
  proposals: Proposal[];
  reviewCount: number;
  firstReviewAt: string | null;
  names: Names;
  /** Preference entity key → readable name. */
  entityNames: Map<string, string>;
  userNames: Map<string, string>;
  /** Change sets that were undone (an accepted proposal later undone). */
  undone: Set<string>;
}

function words(s: string): string {
  const w = s.replace(/[_-]+/g, " ").trim();
  return w === "" ? s : `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
}

/** Names for the preferences' keys: dish / variant / ingredient ids, cuisine and method keys. */
async function entityNamesOf(
  prefs: readonly Preference[],
  names: Names,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [cuisines, methods] = await Promise.all([
    api.call(cuisinesList, {}),
    api.call(methodsList, {}),
  ]);
  for (const c of cuisines.cuisines ?? []) out.set(`cuisine:${c.key}`, c.label);
  for (const m of methods.methods ?? []) out.set(`method:${m.key}`, m.label);
  const variantDishes = new Set<string>();
  const ingredients = new Set<string>();
  for (const p of prefs) {
    if (p.entityType === "dish") {
      const [dishId, variantId] = p.entityKey.split("#");
      if (variantId !== undefined && dishId !== undefined) variantDishes.add(dishId);
      else out.set(`dish:${p.entityKey}`, names.get(p.entityKey) ?? "A dish");
    }
    if (p.entityType === "ingredient") ingredients.add(p.entityKey);
  }
  await Promise.all([
    ...[...variantDishes].slice(0, 30).map(async (id) => {
      try {
        const d = await api.call(dishesGet, { params: { id } });
        for (const c of d.components)
          for (const v of c.variants)
            out.set(`dish:${d.id}#${v.id}`, `${v.label} ${c.name.toLowerCase()}`);
      } catch {
        // A dish that is gone keeps the generic name.
      }
    }),
    ...[...ingredients].slice(0, 60).map(async (id) => {
      try {
        out.set(`ingredient:${id}`, (await api.call(ingredientsGet, { params: { id } })).name);
      } catch {
        // Unknown ingredient keeps the generic name.
      }
    }),
  ]);
  return out;
}

function nameOf(p: Preference, entityNames: Map<string, string>): { name: string; type: string } {
  const variant = p.entityType === "dish" && p.entityKey.includes("#");
  const type = variant ? "variant" : p.entityType;
  const known = entityNames.get(`${p.entityType}:${p.entityKey}`);
  const name =
    known ??
    (p.entityType === "component_role"
      ? (ROLE_LABELS[p.entityKey] ?? words(p.entityKey))
      : p.entityType === "flavour_tag"
        ? words(p.entityKey)
        : variant
          ? "A variant"
          : `A${type === "ingredient" ? "n" : ""} ${TYPE_LABELS[type] ?? type}`);
  return { name, type: TYPE_LABELS[type] ?? type };
}

function score(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
}

function PreferenceTable({
  title,
  tone,
  rows,
  data,
  memberId,
  onChanged,
}: {
  readonly title: string;
  readonly tone: "like" | "dislike";
  readonly rows: readonly Preference[];
  readonly data: Data;
  readonly memberId: string | null;
  readonly onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("0");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canChange = data.viewer.role === "admin" || memberId === data.viewer.memberId;

  async function run(key: string, work: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await work();
      setEditing(null);
      await onChanged();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const colour = tone === "like" ? "text-basil-text" : "text-pomegranate-text";
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-card p-[18px] shadow-card">
      <h2 className={`text-xl ${colour}`}>{title}</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-soft">
          {tone === "like"
            ? "Nothing learned as a favourite yet."
            : "Nothing learned as disliked yet."}
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-extrabold text-ink-soft">
              <th scope="col" className="py-1 pr-2">
                What
              </th>
              <th scope="col" className="py-1 pr-2">
                Score
              </th>
              <th scope="col" className="py-1 pr-2">
                Evidence
              </th>
              <th scope="col" className="py-1">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const { name, type } = nameOf(p, data.entityNames);
              const key = p.id;
              const body = {
                memberId: p.memberId,
                entityType: p.entityType,
                entityKey: p.entityKey,
              };
              return (
                <tr key={key} className="align-middle">
                  <th scope="row" className="py-1 pr-2 text-left font-extrabold">
                    {name} <span className="font-semibold text-ink-soft">({type})</span>
                    {p.locked && (
                      <span className="ml-1 text-xs font-bold text-ink-soft">· locked</span>
                    )}
                  </th>
                  <td className={`py-1 pr-2 tabular ${colour}`}>
                    {editing === key ? (
                      <label>
                        <span className="sr-only">New score for {name}, −1 to +1</span>
                        <input
                          type="number"
                          min={-1}
                          max={1}
                          step={0.05}
                          value={value}
                          onChange={(e) => {
                            setValue(e.target.value);
                          }}
                          className="min-h-11 w-20 rounded-[10px] border-[1.5px] border-line-strong bg-card px-2 text-ink"
                        />
                      </label>
                    ) : (
                      score(p.score)
                    )}
                  </td>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <Link
                      href={`/reviews${p.memberId === null ? "" : `?member=${p.memberId}`}`}
                      className="font-extrabold"
                      aria-label={`Evidence for ${name}: weight ${p.evidenceWeight.toFixed(1)}, open the reviews`}
                    >
                      evidence {p.evidenceWeight.toFixed(1)}
                    </Link>
                  </td>
                  <td className="py-1 whitespace-nowrap">
                    {canChange && (
                      <div className="flex flex-wrap justify-end gap-1 xl:flex-nowrap">
                        {editing === key ? (
                          <>
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 text-[13px]"
                              loading={busy === key}
                              onClick={() => {
                                const n = Math.max(-1, Math.min(1, Number(value)));
                                if (!Number.isFinite(n)) return;
                                void run(key, () =>
                                  api.call(preferencesSet, {
                                    body: { ...body, score: n, locked: true, hard: p.hard },
                                  }),
                                );
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 text-[13px]"
                              onClick={() => {
                                setEditing(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 text-[13px]"
                              loading={busy === `${key}-lock`}
                              aria-label={`${p.locked ? "Unlock" : "Lock"} ${name}`}
                              onClick={() => {
                                void run(`${key}-lock`, () =>
                                  api.call(preferencesSet, {
                                    body: {
                                      ...body,
                                      score: p.score,
                                      locked: !p.locked,
                                      hard: p.hard,
                                    },
                                  }),
                                );
                              }}
                            >
                              {p.locked ? "Unlock" : "Lock"}
                            </Button>
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 text-[13px]"
                              aria-label={`Edit ${name}`}
                              onClick={() => {
                                setValue(p.score.toFixed(2));
                                setEditing(key);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              className="min-h-9 px-2 text-[13px]"
                              loading={busy === `${key}-reset`}
                              aria-label={`Reset ${name}`}
                              onClick={() => {
                                void run(`${key}-reset`, () =>
                                  api.call(preferencesReset, { body }),
                                );
                              }}
                            >
                              Reset
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <FormError>{error}</FormError>
    </section>
  );
}

function PendingProposal({
  proposal,
  names,
  onChanged,
}: {
  readonly proposal: Proposal;
  readonly names: Names;
  readonly onChanged: () => Promise<void>;
}) {
  const title = proposalTitle(proposal);
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<Description[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const evidence = evidenceText(proposal.evidence);

  async function toggle() {
    setOpen((o) => !o);
    if (diff !== null) return;
    const ops = proposalOps(proposal);
    if (ops.length === 0) {
      setDiff([]);
      return;
    }
    try {
      setDiff((await api.call(changeSetsPreview, { body: { ops } })).descriptions ?? []);
    } catch (err) {
      setError(problemMessage(err));
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-card bg-paper p-3.5 lg:flex-row lg:items-center"
      data-proposal-id={proposal.id}
    >
      <div className="flex grow flex-col gap-1">
        <span className="font-extrabold">{title}</span>
        <span className="text-[13px] text-ink-soft">
          {proposal.rationale}
          {evidence !== null && ` · ${evidence}`}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            void toggle();
          }}
          className="min-h-9 self-start rounded-md px-1 text-[13px] font-extrabold text-action"
        >
          {open ? "Hide what changes" : "What changes"}
        </button>
        {open &&
          (diff === null ? (
            error === null ? (
              <SkeletonBlock label="Working out what changes" lines={2} />
            ) : (
              <FormError>{error}</FormError>
            )
          ) : diff.length === 0 ? (
            <span className="text-[13px] text-ink-soft">Nothing would change now.</span>
          ) : (
            <ChangeDiff descriptions={diff} names={names} />
          ))}
      </div>
      <div className="shrink-0">
        <ProposalActions proposalId={proposal.id} title={title} onChanged={onChanged} />
      </div>
    </li>
  );
}

/** Learned values closer to 0 than this are noise from one review's spread; not listed. */
const SHOWN_MIN = 0.05;

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function InsightsScreen() {
  const load = useLoad<Data>(async () => {
    const viewer = await loadViewer();
    const admin = viewer.role === "admin";
    const [prefs, biases, proposals, reviews, names, access, log] = await Promise.all([
      api.call(preferencesList, { query: {} }).then((r) => r.preferences ?? []),
      api.call(portionBiasesList, { query: {} }).then((r) => r.biases ?? []),
      admin
        ? api.call(proposalsList, { query: {} }).then((r) => r.proposals ?? [])
        : Promise.resolve([] as Proposal[]),
      api.call(reviewsList, { query: { limit: 200 } }).then((r) => r.reviews ?? []),
      loadNames(),
      admin
        ? api.call(accessList, {}).then((r) => r.logins)
        : Promise.resolve([] as { userId: string; name: string }[]),
      admin
        ? api.call(changeSetsList, { query: { limit: 200 } }).then((r) => r.entries ?? [])
        : Promise.resolve([]),
    ]);
    const firstReviewAt = reviews.reduce<string | null>(
      (min, r) => (min === null || r.createdAt < min ? r.createdAt : min),
      null,
    );
    return {
      viewer,
      preferences: prefs,
      biases,
      proposals,
      reviewCount: reviews.filter((r) => r.parentReviewId === null).length,
      firstReviewAt,
      names,
      entityNames: await entityNamesOf(prefs, names),
      userNames: new Map(access.map((l) => [l.userId, l.name])),
      undone: new Set(
        log.flatMap((e) => (e.type === "change_set" && e.undoneAt !== null ? [e.id] : [])),
      ),
    };
  });
  const [chosen, setChosen] = useState<string | null>(null);

  const data = load.status === "ready" ? load.data : null;
  const people = useMemo(() => {
    if (data === null) return [];
    return data.viewer.role === "admin"
      ? data.viewer.members
      : data.viewer.members.filter((m) => m.id === data.viewer.memberId);
  }, [data]);
  const memberId = chosen ?? people[0]?.id ?? null;

  if (load.status === "loading")
    return <SkeletonBlock label="Loading what the app has learned" lines={8} />;
  if (load.status === "error")
    return <LoadError message={load.message} onRetry={() => void load.reload()} />;
  const d = load.data;
  const member = d.viewer.members.find((m) => m.id === memberId) ?? null;
  const theirs = d.preferences
    .filter((p) => p.memberId === memberId)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  const likes = theirs.filter((p) => p.score >= SHOWN_MIN).slice(0, 8);
  const dislikes = theirs.filter((p) => p.score <= -SHOWN_MIN).slice(0, 8);
  const biases = d.biases.filter((b) => b.memberId === memberId);
  const pending = d.proposals.filter((p) => p.status === "pending");
  const decided = d.proposals
    .filter((p) => p.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.expiresAt).localeCompare(a.decidedAt ?? a.expiresAt))
    .slice(0, 10);
  const weeks =
    d.firstReviewAt === null
      ? 0
      : Math.max(1, Math.ceil((Date.now() - Date.parse(d.firstReviewAt)) / (7 * 86_400_000)));
  const ask = `/chat?prompt=${encodeURIComponent("What have you learned this week?")}`;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[28px] lg:text-[32px]">What the app has learned</h1>
          <p className="m-0 mt-1 text-ink-soft">
            {d.reviewCount === 0
              ? "Nothing yet: it learns from reviews. Everything here can be locked, edited or reset."
              : `From ${String(d.reviewCount)} ${d.reviewCount === 1 ? "review" : "reviews"} over ${String(weeks)} ${weeks === 1 ? "week" : "weeks"}. Everything here can be locked, edited or reset.`}
          </p>
        </div>
        {d.viewer.role === "admin" && (
          <Link
            href={ask}
            className={buttonClasses(
              "primary",
              "md",
              "bg-agent text-on-agent hover:bg-agent-raised hover:text-on-agent",
            )}
          >
            Ask: what changed this week?
          </Link>
        )}
      </div>

      {people.length > 1 && (
        <div role="group" aria-label="Whose tastes" className="flex flex-wrap gap-2">
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === memberId}
              onClick={() => {
                setChosen(m.id);
              }}
              className={`min-h-11 rounded-full px-3.5 text-sm font-extrabold ${
                m.id === memberId ? "bg-ink text-paper" : "bg-flour text-ink hover:bg-line-strong"
              }`}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      )}

      {member === null ? (
        <EmptyState
          icon="insights"
          headingLevel={2}
          title="No one to show yet"
          description="Add the family on the Family screen; what each person likes shows up here as they review meals."
        />
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <PreferenceTable
              title={`${member.displayName} likes`}
              tone="like"
              rows={likes}
              data={d}
              memberId={member.id}
              onChanged={load.reload}
            />
            <PreferenceTable
              title={`${member.displayName} dislikes`}
              tone="dislike"
              rows={dislikes}
              data={d}
              memberId={member.id}
              onChanged={load.reload}
            />
          </div>
          <section className="flex flex-col gap-2 rounded-2xl bg-card p-[18px] shadow-card lg:flex-row lg:items-center lg:gap-4">
            <h2 className="font-body text-[15px] font-extrabold">
              Portions for {member.displayName}
            </h2>
            {member.isTargeted ? (
              <span className="text-sm">Set by {member.displayName}'s targets, not learned.</span>
            ) : biases.length === 0 ? (
              <span className="text-sm">Standard portions: nothing learned yet.</span>
            ) : (
              <span className="text-sm tabular">
                {biases
                  .map(
                    (b) =>
                      `${ROLE_LABELS[b.componentRole] ?? words(b.componentRole)} × ${b.factor.toFixed(2)}`,
                  )
                  .join(" · ")}
              </span>
            )}
            {!member.isTargeted && (
              <span className="text-[13px] text-ink-soft">
                (learned from “too much”, “too little” and “still hungry”)
              </span>
            )}
            {d.viewer.role === "admin" && (
              <Link href="/changelog" className="font-extrabold lg:ml-auto">
                History
              </Link>
            )}
          </section>
        </>
      )}

      {d.viewer.role === "admin" && (
        <section
          id="waiting"
          aria-labelledby="waiting-title"
          className="flex flex-col gap-3 rounded-2xl bg-card p-[18px] shadow-card"
        >
          <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
            <h2 id="waiting-title" className="text-[22px]">
              Waiting for your decision
            </h2>
            <span className="text-sm text-ink-soft">
              {pending.length} of max {PROPOSAL_BUDGET} · expire after {PROPOSAL_EXPIRY_DAYS} days
            </span>
          </div>
          {pending.length === 0 ? (
            <p className="m-0 text-sm text-ink-soft">
              Nothing is waiting. New suggestions appear here and in the assistant.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {pending.map((p) => (
                <PendingProposal key={p.id} proposal={p} names={d.names} onChanged={load.reload} />
              ))}
            </ul>
          )}
        </section>
      )}

      {d.viewer.role === "admin" && decided.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl bg-card p-[18px] shadow-card">
          <h2 className="text-xl">Past decisions</h2>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
            {decided.map((p) => {
              const by =
                p.decidedByUserId === null
                  ? null
                  : (d.userNames.get(p.decidedByUserId) ?? "an admin");
              const when = p.decidedAt === null ? null : WEEKDAY_OR_DATE(p.decidedAt);
              return (
                <li key={p.id}>
                  <strong
                    className={
                      p.status === "accepted"
                        ? "text-basil-text"
                        : p.status === "rejected"
                          ? "text-pomegranate-text"
                          : "text-ink-soft"
                    }
                  >
                    {p.status === "accepted" &&
                    p.changeSetId !== null &&
                    d.undone.has(p.changeSetId)
                      ? "Accepted, then undone"
                      : words(p.status)}
                  </strong>{" "}
                  · {proposalTitle(p)}
                  {by !== null && ` — ${by}`}
                  {p.decisionNote !== null && `: “${p.decisionNote}”`}
                  {when !== null && `, ${when}`}
                  {p.status === "rejected" && " (won't be suggested again for 30 days)"}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function WEEKDAY_OR_DATE(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "today";
  return WHEN.format(d);
}
