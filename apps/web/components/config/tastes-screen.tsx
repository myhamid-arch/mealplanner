"use client";
// Family tastes (TastesDesktop.dc.html; UX-2 Taste at household level). Basic: the cuisines the
// household likes. Detailed: every person × cuisine, set here or learned from reviews ("L").
// Expert: how each person likes food cooked (method and flavour scores). Never serve for everyone.
import { useState } from "react";
import type { ChangeOp } from "@mealplanner/core/changes";
import { applyChanges, problemText } from "./api";
import { levelOf, useHousehold, type HouseholdData, type Preference } from "./data";
import { NeverServeList } from "./never-serve";
import { ErrorBlock, LoadingBlock, SaveStatus, Section } from "./parts";
import { cuisineLabel, LIKE, NOT_KEEN } from "./tastes-section";
import { DetailControl, TellAssistant, useDetailLevel } from "../detail-level/detail-control";
import { levelRank, type Level } from "../detail-level/logic";
import { Icon } from "../ui/icon";

const HINTS: Readonly<Record<Level, string>> = {
  basic:
    "Basic: the cuisines the whole household likes. Detailed shows each person's likes, set here or learned from reviews.",
  detailed: "Detailed: tap any cell to change it. Expert adds how each person likes food cooked.",
  expert:
    "Expert: how each person likes food cooked, which is why one fish can be grilled for the adults and fried for the kids.",
};

const LOVE = 0.9;

type Cell = "loves" | "likes" | "neutral" | "not";
const CELL: Readonly<Record<Cell, { label: string; mark: string; cls: string }>> = {
  loves: { label: "Loves", mark: "++", cls: "bg-basil-text text-paper" },
  likes: { label: "Likes", mark: "+", cls: "bg-basil-tint text-basil-text" },
  neutral: {
    label: "Neutral",
    mark: "",
    cls: "border-[1.5px] border-line-strong bg-card text-ink",
  },
  not: { label: "Not keen", mark: "–", cls: "bg-pomegranate-text text-paper" },
};

function cellOf(score: number | undefined): Cell {
  if (score === undefined || Math.abs(score) < 0.2) return "neutral";
  if (score < 0) return "not";
  return score >= 0.7 ? "loves" : "likes";
}

const NEXT: Readonly<Record<Cell, number | null>> = {
  neutral: LIKE,
  likes: LOVE,
  loves: NOT_KEEN,
  not: null,
};

const METHODS: readonly { type: Preference["entityType"]; key: string; label: string }[] = [
  { type: "method", key: "grilled", label: "Grilled" },
  { type: "method", key: "breaded_fried", label: "Breaded-fried" },
  { type: "method", key: "roasted", label: "Roasted" },
  { type: "method", key: "deep_fried", label: "Deep-fried" },
  { type: "flavour_tag", key: "spicy", label: "Spicy" },
];

function prefOf(
  data: HouseholdData,
  memberId: string | null,
  type: Preference["entityType"],
  key: string,
) {
  const rows = data.preferences.filter(
    (p) => p.memberId === memberId && p.entityType === type && p.entityKey === key,
  );
  const own = rows.find((p) => p.source === "explicit");
  const learned = rows.find((p) => p.source === "learned");
  return { own, learned, shown: own ?? learned };
}

function Grid({
  data,
  rows,
  onSet,
  caption,
  short,
}: {
  readonly data: HouseholdData;
  readonly rows: readonly { type: Preference["entityType"]; key: string; label: string }[];
  readonly onSet: (
    memberId: string,
    type: Preference["entityType"],
    key: string,
    label: string,
    score: number | null,
  ) => Promise<void>;
  readonly caption: string;
  readonly short?: boolean;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-separate border-spacing-1.5 text-sm">
        <caption className="sr-only-focusable">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="text-left">
              <span className="sr-only-focusable">Food</span>
            </th>
            {data.members.map((m) => (
              <th key={m.id} scope="col" className="min-w-14 font-extrabold" title={m.displayName}>
                {short === true ? m.displayName.charAt(0) : m.displayName}
              </th>
            ))}
            {short !== true && (
              <th scope="col" className="font-extrabold">
                Household
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const hh = prefOf(data, null, row.type, row.key).shown;
            return (
              <tr key={`${row.type}:${row.key}`} data-taste-row={row.key}>
                <th scope="row" className="pr-2 text-left font-extrabold">
                  {row.label}
                </th>
                {data.members.map((m) => {
                  const { own, learned, shown } = prefOf(data, m.id, row.type, row.key);
                  const cell = cellOf(shown?.score);
                  const next = NEXT[cellOf(own?.score)];
                  return (
                    <td key={m.id}>
                      <button
                        type="button"
                        data-cell={`${m.displayName}|${row.key}`}
                        data-state={cell}
                        aria-label={`${m.displayName}, ${row.label}: ${CELL[cell].label}${own === undefined && learned !== undefined ? ", learned from reviews" : ""}. Tap to change.`}
                        onClick={() =>
                          void onSet(
                            m.id,
                            row.type,
                            row.key,
                            row.label,
                            own === undefined && next === null ? LIKE : next,
                          )
                        }
                        className={`flex h-11 w-full min-w-11 items-center justify-center rounded-md text-xs font-extrabold ${CELL[cell].cls}`}
                      >
                        {own === undefined && learned !== undefined ? "L" : CELL[cell].mark}
                      </button>
                    </td>
                  );
                })}
                {short !== true && (
                  <td className="tabular text-center font-extrabold text-basil-text">
                    {hh === undefined ? "—" : `${hh.score > 0 ? "+" : ""}${hh.score.toFixed(2)}`}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TastesScreen() {
  const { data, error, loading, reload } = useHousehold();
  if (data === null)
    return error === null || loading ? (
      <LoadingBlock label="Loading tastes" />
    ) : (
      <ErrorBlock message={error} onRetry={() => void reload()} />
    );
  return <Tastes data={data} reload={reload} />;
}

function Tastes({
  data,
  reload,
}: {
  readonly data: HouseholdData;
  readonly reload: () => Promise<void>;
}) {
  const {
    level,
    change,
    error: levelError,
  } = useDetailLevel(null, "taste", levelOf(data, null, "taste"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
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
  const setPref = (
    memberId: string | null,
    type: Preference["entityType"],
    key: string,
    label: string,
    score: number | null,
  ) =>
    run(
      `${memberId === null ? "Household" : (data.members.find((m) => m.id === memberId)?.displayName ?? "")}: ${label}`,
      score === null
        ? [
            {
              kind: "preference.reset",
              payload: { memberId, entityType: type, entityKey: key, source: "explicit" },
            },
          ]
        : [
            {
              kind: "preference.set",
              payload: { memberId, entityType: type, entityKey: key, score, source: "explicit" },
            },
          ],
    );
  const memberExplicit = (types: Preference["entityType"][]) =>
    data.preferences.filter(
      (p) => p.memberId !== null && p.source === "explicit" && types.includes(p.entityType),
    );
  const hiddenAt = (l: Level) =>
    (levelRank(l) < 1 ? memberExplicit(["cuisine"]).length : 0) +
    (levelRank(l) < 2 ? memberExplicit(["method", "flavour_tag"]).length : 0);
  const reset = async (l: Level) => {
    const rows = [
      ...(levelRank(l) < 1 ? memberExplicit(["cuisine"]) : []),
      ...memberExplicit(["method", "flavour_tag"]),
    ];
    if (rows.length > 0)
      await applyChanges(
        "Reset family tastes to automatic",
        rows.map((p) => ({
          kind: "preference.reset",
          payload: {
            memberId: p.memberId,
            entityType: p.entityType,
            entityKey: p.entityKey,
            source: "explicit",
          },
        })),
      );
    await reload();
  };
  const householdLiked = new Set(
    data.preferences
      .filter((p) => p.memberId === null && p.entityType === "cuisine" && p.score > 0)
      .map((p) => p.entityKey),
  );
  const cuisineRows = [
    ...new Set([
      ...householdLiked,
      ...data.preferences.filter((p) => p.entityType === "cuisine").map((p) => p.entityKey),
    ]),
  ].map((key) => ({ type: "cuisine" as const, key, label: cuisineLabel(data, key) }));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[34px]">Family tastes</h1>
          <p className="m-0 text-ink-soft">
            What everyone likes. Set it here, let reviews teach it, or both.
          </p>
        </div>
        <DetailControl
          scope="family tastes"
          level={level}
          onLevel={change}
          hints={HINTS}
          hiddenAt={hiddenAt}
          onReset={reset}
          error={levelError}
        />
      </div>
      <Section id="cuisines" title="Cuisines">
        {levelRank(level) === 0 ? (
          <div
            className="flex flex-wrap gap-2.5"
            role="group"
            aria-label="Cuisines the household likes"
          >
            {data.cuisines.map((cu, i) => {
              const on = householdLiked.has(cu.key);
              return (
                <button
                  key={cu.key}
                  type="button"
                  aria-pressed={on}
                  data-sticker={cu.key}
                  onClick={() => void setPref(null, "cuisine", cu.key, cu.label, on ? null : LIKE)}
                  style={{ transform: `rotate(${String([-2, 1, -1, 2][i % 4])}deg)` }}
                  className={`min-h-11 rounded-lg px-4 font-extrabold ${on ? "bg-basil-text text-paper" : "border-[1.5px] border-line-strong bg-card text-ink"}`}
                >
                  {cu.label}
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <ul
              className="m-0 flex list-none flex-wrap gap-3 p-0 text-sm font-extrabold"
              aria-label="Legend"
            >
              {(["loves", "likes", "neutral", "not"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-full text-[10px] ${CELL[k].cls}`}
                  >
                    {CELL[k].mark}
                  </span>
                  {CELL[k].label}
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="text-aubergine-text">L</span> learned from reviews
              </li>
            </ul>
            {cuisineRows.length === 0 ? (
              <p className="m-0 text-sm text-ink-soft">
                No cuisine likes yet. Pick some at Basic, or let ratings teach them.
              </p>
            ) : (
              <Grid
                data={data}
                rows={cuisineRows}
                onSet={(m, t, k, label, s) => setPref(m, t, k, label, s)}
                caption="Cuisine likes per person"
              />
            )}
            <p className="m-0 text-sm text-ink-soft">
              Tap any cell to change it. &ldquo;Household&rdquo; is set for everyone; the planner
              leans towards whoever likes a dish least (fairness, in Planning balance).
            </p>
          </>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="never-serve" title="Never serve">
          <NeverServeList data={data} onChanged={reload} />
        </Section>
        {levelRank(level) === 2 && (
          <Section id="cooked" title="How they like it cooked">
            <Grid
              data={data}
              rows={METHODS}
              onSet={(m, t, k, label, s) => setPref(m, t, k, label, s)}
              caption="Cooking method likes per person"
              short
            />
            <p className="m-0 text-sm text-ink-soft">
              This is why one fish can be grilled for the adults and fried for the kids.
            </p>
          </Section>
        )}
      </div>
      <section
        aria-label="Taste swipe"
        className="flex flex-wrap items-center gap-3.5 rounded-2xl bg-agent p-4 text-on-agent sm:p-5"
      >
        <Icon name="assistant" size={26} />
        <p className="m-0 grow">
          Send a 60-second taste swipe to everyone with a login. Results fill in the grid above.
        </p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(`${window.location.origin}/family/me`)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                setCopied(false);
              });
          }}
          className="min-h-11 rounded-md bg-card px-4 font-extrabold text-aubergine-text"
        >
          {copied ? "Link copied" : "Copy taste swipe link"}
        </button>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStatus error={error} saved={saved} />
        <TellAssistant prompt="About the family's tastes: " />
      </div>
    </div>
  );
}
