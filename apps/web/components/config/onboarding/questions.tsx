"use client";
// The five onboarding questions (R2-ONB-1; Onboarding.dc.html). Each is optional (R2-ONB-2); free
// text is parsed by the deterministic parsers of @mealplanner/core/onboarding and the parse is shown
// for confirmation (R2-ONB-3; the model-backed parse is W-5, R-47).
import { useId, type ReactNode } from "react";
import {
  isChild,
  MEMBER_COLOR_ORDER,
  targetsText,
  type NeverEatItem,
  type NeverEatQuestion,
  type PersonAnswer,
  type TargetParse,
  type TrainingTime,
} from "@mealplanner/core/onboarding";
import { avatarPalette, type AvatarColor } from "@mealplanner/ui-tokens/tokens";
import { WeekdayPicker } from "../parts";
import type { Cuisine } from "../data";

export const MON_FRI = [0, 1, 2, 3, 4];

export function Heading({
  n,
  title,
  lead,
}: {
  readonly n: number;
  readonly title: string;
  readonly lead: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-extrabold text-tomato-text">QUESTION {n} OF 5</span>
      <h1 id={`q${String(n)}-title`} className="text-[30px] sm:text-[36px]">
        {title}
      </h1>
      <p className="m-0 text-ink-soft">{lead}</p>
    </div>
  );
}

export function PersonChip({
  person,
  index,
}: {
  readonly person: PersonAnswer;
  readonly index: number;
}) {
  const color = MEMBER_COLOR_ORDER[index % MEMBER_COLOR_ORDER.length] as AvatarColor;
  const { fill, ink } = avatarPalette[color];
  return (
    <span
      className="rounded-full px-3 py-2 font-extrabold"
      style={{ background: fill, color: ink }}
    >
      {person.name}
      {person.age === null ? "" : ` · ${String(person.age)}`}
    </span>
  );
}

export function PeopleQuestion({
  text,
  onText,
  people,
  error,
}: {
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly people: readonly PersonAnswer[];
  readonly error: string | null;
}) {
  return (
    <>
      <Heading
        n={1}
        title="Who eats at home?"
        lead="Names and ages, in one line. Ages let the app set sensible starting portions."
      />
      <label className="flex flex-col gap-1">
        <span className="sr-only-focusable">Household members</span>
        <input
          value={text}
          onChange={(e) => {
            onText(e.target.value);
          }}
          placeholder="Omar 41, Sara 39, Layla 18, Adam 15, Zayd 10"
          className="min-h-14 w-full rounded-xl border-2 border-action bg-card px-4 text-lg font-bold sm:text-xl"
        />
      </label>
      {/* node-scripts (R-69, R-71): a labelled group; aria-label is prohibited on a div with no role. */}
      <div className="flex flex-wrap gap-2" role="group" aria-live="polite" aria-label="Read as">
        {people.map((p, i) => (
          <PersonChip key={`${p.name}-${String(i)}`} person={p} index={i} />
        ))}
      </div>
      {error !== null && (
        <p role="alert" className="m-0 font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </>
  );
}

export function TargetsQuestion({
  people,
  tapped,
  onTap,
  texts,
  onText,
  parses,
}: {
  readonly people: readonly PersonAnswer[];
  readonly tapped: ReadonlySet<string>;
  readonly onTap: (name: string) => void;
  readonly texts: Readonly<Record<string, string>>;
  readonly onText: (name: string, text: string) => void;
  readonly parses: Readonly<Record<string, TargetParse>>;
}) {
  const untapped = people.filter((p) => !tapped.has(p.name));
  return (
    <>
      <Heading
        n={2}
        title="Who follows macro targets?"
        lead="Tap the people who do. Type their numbers in any format, or paste them from a coach."
      />
      <div className="flex flex-col gap-2.5">
        {people
          .filter((p) => tapped.has(p.name))
          .map((p) => {
            const parse = parses[p.name];
            return (
              <div
                key={p.name}
                className="flex flex-col gap-2 rounded-xl border-2 border-sea bg-card p-3 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  aria-pressed
                  onClick={() => {
                    onTap(p.name);
                  }}
                  className="min-h-11 w-[110px] text-left font-extrabold text-ink"
                  aria-label={`${p.name} follows targets. Tap to remove.`}
                >
                  {p.name}
                </button>
                <div className="flex grow flex-col gap-1">
                  <input
                    aria-label={`${p.name}'s targets`}
                    value={texts[p.name] ?? ""}
                    onChange={(e) => {
                      onText(p.name, e.target.value);
                    }}
                    placeholder="2150 cal, 180p 200c 70f"
                    className="tabular min-h-11 w-full rounded-lg border-[1.5px] border-line-strong px-3"
                  />
                  {parse !== undefined && (texts[p.name] ?? "").trim() !== "" && (
                    <span
                      aria-live="polite"
                      className={`text-sm ${parse.ok ? "text-ink-soft" : "font-bold text-pomegranate-text"}`}
                    >
                      {parse.ok
                        ? `Read as ${targetsText(parse.value)} (total carbs)${parse.value.training === undefined ? "" : `; training days ${targetsText(parse.value.training)}`}`
                        : parse.reason}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        <div className="flex flex-wrap items-center gap-2">
          {untapped.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={false}
              onClick={() => {
                onTap(p.name);
              }}
              className="min-h-11 rounded-lg bg-flour px-3.5 font-extrabold text-ink-soft"
            >
              {p.name}
            </button>
          ))}
          {untapped.length > 0 && <span className="text-sm text-ink-soft">no targets</span>}
        </div>
      </div>
    </>
  );
}

export interface WeekState {
  school: { on: boolean; people: string[]; days: number[] };
  work: { on: boolean; people: string[]; days: number[] };
  training: Record<string, { on: boolean; days: number[]; time: TrainingTime }>;
  snacks: boolean;
}

export function defaultWeek(people: readonly PersonAnswer[]): WeekState {
  return {
    school: {
      on: false,
      people: people.filter((p) => isChild(p.age) && (p.age ?? 0) >= 4).map((p) => p.name),
      days: MON_FRI,
    },
    work: { on: false, people: [], days: MON_FRI },
    training: {},
    snacks: true,
  };
}

function Card({
  title,
  on,
  onToggle,
  summary,
  children,
  pressed,
}: {
  readonly title: string;
  readonly on: boolean;
  readonly onToggle: () => void;
  readonly summary: string;
  readonly children?: ReactNode;
  /** The button's pressed state when it differs from the highlight (the snacks card). */
  readonly pressed?: boolean;
}) {
  const id = useId();
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl bg-card p-3.5 ${on ? "border-[2.5px] border-action" : "border-[1.5px] border-line-strong"}`}
    >
      <button
        type="button"
        aria-pressed={pressed ?? on}
        aria-describedby={id}
        onClick={onToggle}
        className="min-h-11 text-left font-extrabold text-ink"
      >
        {title}
      </button>
      <span id={id} className="text-sm text-ink-soft">
        {summary}
      </span>
      {on && children}
    </div>
  );
}

function PeoplePicker({
  label,
  people,
  value,
  onChange,
}: {
  readonly label: string;
  readonly people: readonly PersonAnswer[];
  readonly value: readonly string[];
  readonly onChange: (v: string[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = value.includes(p.name);
        return (
          <button
            key={p.name}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange(on ? value.filter((n) => n !== p.name) : [...value, p.name]);
            }}
            className={`min-h-11 rounded-md px-3 text-sm font-extrabold ${on ? "bg-ink text-paper" : "bg-flour text-ink-soft"}`}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const days = (d: readonly number[]) =>
  d.length === 5 && d.every((x, i) => x === i) ? "Mon–Fri" : d.map((x) => DAY[x]).join(" ");

export function WeekQuestion({
  people,
  week,
  onWeek,
}: {
  readonly people: readonly PersonAnswer[];
  readonly week: WeekState;
  readonly onWeek: (w: WeekState) => void;
}) {
  const trainers = Object.entries(week.training).filter(([, t]) => t.on);
  return (
    <>
      <Heading
        n={3}
        title="What does a normal week look like?"
        lead="Tap what's true. Pick days only where asked."
      />
      <div className="grid gap-2.5 md:grid-cols-2">
        <Card
          title="Kids go to school"
          on={week.school.on}
          onToggle={() => {
            onWeek({ ...week, school: { ...week.school, on: !week.school.on } });
          }}
          summary={
            week.school.people.length === 0
              ? "Pick who"
              : `${week.school.people.join(", ")} · ${days(week.school.days)}`
          }
        >
          <PeoplePicker
            label="Who goes to school"
            people={people}
            value={week.school.people}
            onChange={(v) => {
              onWeek({ ...week, school: { ...week.school, people: v } });
            }}
          />
          <WeekdayPicker
            label="School days"
            value={week.school.days}
            onChange={(d) => {
              onWeek({ ...week, school: { ...week.school, days: d } });
            }}
          />
        </Card>
        <Card
          title="Someone eats lunch at work"
          on={week.work.on}
          onToggle={() => {
            onWeek({ ...week, work: { ...week.work, on: !week.work.on } });
          }}
          summary={
            week.work.people.length === 0
              ? "Pick who"
              : `${week.work.people.join(", ")} · ${days(week.work.days)}`
          }
        >
          <PeoplePicker
            label="Who eats lunch at work"
            people={people}
            value={week.work.people}
            onChange={(v) => {
              onWeek({ ...week, work: { ...week.work, people: v } });
            }}
          />
          <WeekdayPicker
            label="Work days"
            value={week.work.days}
            onChange={(d) => {
              onWeek({ ...week, work: { ...week.work, days: d } });
            }}
          />
        </Card>
        <Card
          title="Someone trains"
          on={trainers.length > 0 || Object.keys(week.training).length > 0}
          onToggle={() => {
            onWeek({
              ...week,
              training:
                Object.keys(week.training).length > 0
                  ? {}
                  : {
                      [people.find((p) => !isChild(p.age))?.name ?? people[0]?.name ?? ""]: {
                        on: true,
                        days: [0, 2, 4],
                        time: "evening",
                      },
                    },
            });
          }}
          summary={
            trainers.length === 0
              ? "Pick who, which days, morning or evening"
              : trainers.map(([n, t]) => `${n} · ${days(t.days)} · ${t.time}`).join(" / ")
          }
        >
          <div className="flex flex-col gap-2.5">
            {people.map((p) => {
              const t = week.training[p.name] ?? {
                on: false,
                days: [0, 2, 4],
                time: "evening" as const,
              };
              const set = (next: typeof t) => {
                onWeek({ ...week, training: { ...week.training, [p.name]: next } });
              };
              return (
                <div key={p.name} className="flex flex-col gap-1.5">
                  <label className="flex min-h-11 items-center gap-2 font-extrabold">
                    <input
                      type="checkbox"
                      checked={t.on}
                      onChange={() => {
                        set({ ...t, on: !t.on });
                      }}
                      className="size-5"
                    />
                    {p.name}
                  </label>
                  {t.on && (
                    <>
                      <WeekdayPicker
                        label={`${p.name}'s training days`}
                        value={t.days}
                        onChange={(d) => {
                          set({ ...t, days: d });
                        }}
                      />
                      <div
                        role="radiogroup"
                        aria-label={`${p.name} trains in the`}
                        className="flex gap-1.5"
                      >
                        {(["morning", "evening"] as const).map((time) => (
                          <button
                            key={time}
                            type="button"
                            role="radio"
                            aria-checked={t.time === time}
                            onClick={() => {
                              set({ ...t, time });
                            }}
                            className={`min-h-11 rounded-md px-3 text-sm font-extrabold ${t.time === time ? "bg-ink text-paper" : "bg-flour text-ink-soft"}`}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
        <Card
          title="We snack between meals"
          on={!week.snacks}
          pressed={week.snacks}
          onToggle={() => {
            onWeek({ ...week, snacks: !week.snacks });
          }}
          summary={
            week.snacks
              ? "Already assumed. Tap to turn off."
              : "No snacks. Tap to turn them back on."
          }
        />
      </div>
    </>
  );
}

/** The mockup's ten stickers first; the rest of the catalogue after "More cuisines". */
const FIRST = [
  "levantine",
  "italian",
  "indian",
  "british",
  "american",
  "emirati_gulf",
  "japanese",
  "mexican",
  "thai",
  "persian",
];

export function CuisineQuestion({
  cuisines,
  chosen,
  onToggle,
  showAll,
  onShowAll,
}: {
  readonly cuisines: readonly Cuisine[];
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
  readonly showAll: boolean;
  readonly onShowAll: () => void;
}) {
  const first = FIRST.map((k) => cuisines.find((c) => c.key === k)).filter(
    (c): c is Cuisine => c !== undefined,
  );
  const rest = cuisines.filter((c) => !FIRST.includes(c.key));
  const shown = showAll ? [...first, ...rest] : first;
  return (
    <>
      <Heading
        n={4}
        title="What food does the family love?"
        lead="Tap any. Individual tastes are learned later from ratings."
      />
      <div role="group" aria-label="Cuisines the family loves" className="flex flex-wrap gap-2.5">
        {shown.map((c, i) => {
          const on = chosen.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              data-sticker={c.key}
              onClick={() => {
                onToggle(c.key);
              }}
              style={on ? { transform: `rotate(${String([-2, 1, -1, 2][i % 4])}deg)` } : undefined}
              className={`min-h-12 rounded-xl px-4 font-extrabold ${on ? "bg-basil-text text-paper" : "border-[1.5px] border-line-strong bg-card text-ink"}`}
            >
              {c.label}
            </button>
          );
        })}
        {!showAll && rest.length > 0 && (
          <button
            type="button"
            onClick={onShowAll}
            className="min-h-12 px-2 font-extrabold text-action underline"
          >
            More cuisines
          </button>
        )}
      </div>
    </>
  );
}

export function NeverQuestion({
  text,
  onText,
  items,
  describe,
  status,
  questions,
  picks,
  onPick,
  unclear,
}: {
  readonly text: string;
  readonly onText: (t: string) => void;
  readonly items: readonly NeverEatItem[];
  readonly describe: (item: NeverEatItem) => string;
  /** R-88: whether the assistant is reading the answer, has read it, or cannot. */
  readonly status: "reading" | "ready" | "off";
  readonly questions: readonly NeverEatQuestion[];
  /** The option chosen per question; none chosen means the first (the safest reading). */
  readonly picks: readonly number[];
  readonly onPick: (question: number, option: number) => void;
  readonly unclear: readonly string[];
}) {
  return (
    <>
      <Heading
        n={5}
        title="Anything anyone must never eat?"
        lead="Allergies, religious rules, strong dislikes. Plain words are fine."
      />
      <label className="flex flex-col">
        <span className="sr-only-focusable">Never eat</span>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => {
            onText(e.target.value);
          }}
          placeholder="Zayd is allergic to sesame. No pork or alcohol for anyone. Sara hates liver."
          className="w-full resize-none rounded-xl border-2 border-action bg-card px-4 py-3.5 text-lg font-bold"
        />
      </label>
      <p aria-live="polite" className="m-0 text-sm font-bold text-aubergine-text">
        {text.trim() === ""
          ? ""
          : status === "reading"
            ? "The assistant is reading this…"
            : status === "ready"
              ? "Read by the assistant"
              : ""}
      </p>
      {items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Read as">
          {items.map((item, i) => (
            <li key={`${item.who}-${item.term}-${String(i)}`} className="text-ink-soft">
              {describe(item)}
            </li>
          ))}
        </ul>
      )}
      {unclear.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Not understood">
          {unclear.map((line) => (
            <li key={line} className="font-bold text-saffron-text">
              {line}
            </li>
          ))}
        </ul>
      )}
      {questions.map((q, qi) => (
        <fieldset
          key={`${q.who}-${q.said}-${String(qi)}`}
          data-never-question={qi}
          className="m-0 flex flex-col gap-2 rounded-xl border-[1.5px] border-aubergine bg-aubergine-tint p-3.5 text-ink"
        >
          <legend className="sr-only">{q.question}</legend>
          <span aria-hidden className="font-extrabold text-aubergine-text">
            {q.question}
          </span>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o, oi) => {
              const chosen = (picks[qi] ?? 0) === oi;
              return (
                <button
                  key={`${o.label}-${String(oi)}`}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => {
                    onPick(qi, oi);
                  }}
                  className={`min-h-11 rounded-lg border-[1.5px] px-4 font-extrabold ${
                    chosen ? "border-agent bg-agent text-on-agent" : "border-ink bg-card text-ink"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {picks[qi] === undefined && (
            <span className="text-sm text-ink-soft">
              Until you choose, the first answer applies.
            </span>
          )}
        </fieldset>
      ))}
    </>
  );
}
