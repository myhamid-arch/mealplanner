"use client";

// ChatOnboarding.dc.html (R2-ONB-5; leaf-1.4.5 SPEC-Q-10): setting up by conversation. The
// assistant's side is scripted here (no model: the model-backed parse is W-5); it asks the five
// R2-ONB-1 questions in turn, each skippable. Replies are parsed with 1.4.3's deterministic parsers
// into the same `OnboardingAnswers`, `inferSetup` builds the ops, and a setup proposal shows what
// was understood. Nothing is saved until "Create all & plan tomorrow": one change set (undoable),
// then tomorrow's plan, as on the form (R2-ONB-4).
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  parseTargets,
  type InferredSetup,
  type OnboardingAnswers,
  type PersonAnswer,
  type TargetNumbers,
  type TrainingTime,
} from "@mealplanner/core/onboarding";
import { api, applyChanges, c, problemText, useLoad } from "../../config/api";
import type { Cuisine, Ingredient, Slot } from "../../config/data";
import { newId } from "../../config/ids";
import { tomorrowIn } from "../../config/onboarding/onboarding-flow";
import { Button, LinkButton } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { SkeletonBlock } from "../../ui/skeleton";

interface Context {
  slots: Slot[];
  cuisines: Cuisine[];
  ingredients: Ingredient[];
  timezone: string;
  satFatDefaultPct: number;
  existingMembers: number;
}

async function loadContext(): Promise<Context> {
  const [slots, cuisines, ingredients, household, members] = await Promise.all([
    api.call(c.slotsList, {}),
    api.call(c.cuisinesList, {}),
    api.call(c.ingredientsList, { query: { limit: 500 } }),
    api.call(c.householdGet, {}),
    api.call(c.membersList, {}),
  ]);
  return {
    slots: slots.slots ?? [],
    cuisines: cuisines.cuisines ?? [],
    ingredients: ingredients.ingredients ?? [],
    timezone: household.timezone,
    satFatDefaultPct: household.satFatDefaultPct,
    existingMembers: (members.members ?? []).filter((m) => m.archivedAt === null).length,
  };
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MON_FRI = [0, 1, 2, 3, 4];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Question 2 in one message: each person's numbers follow their name ("Omar 2150 cal, 180p …;
 * Sara 1655 / 130 / 160 / 55"). "I" / "me" / "my" mean the admin when the admin is in the family.
 */
export function targetsByPerson(
  text: string,
  names: readonly string[],
  adminName: string,
): { person: string; numbers: TargetNumbers }[] {
  const marks: { at: number; person: string; skip: number }[] = [];
  for (const n of names) {
    const m = new RegExp(`\\b${escape(n)}\\b`, "i").exec(text);
    if (m !== null) marks.push({ at: m.index, person: n, skip: m[0].length });
  }
  const self = names.find(
    (n) => n.toLowerCase() === adminName.trim().split(/\s+/)[0]?.toLowerCase(),
  );
  if (self !== undefined && !marks.some((m) => m.person === self)) {
    const m = /\b(i'm|i am|i|me|my)\b/i.exec(text);
    if (m !== null) marks.push({ at: m.index, person: self, skip: m[0].length });
  }
  marks.sort((a, b) => a.at - b.at);
  const out: { person: string; numbers: TargetNumbers }[] = [];
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.at ?? text.length;
    const parsed = parseTargets(text.slice(m.at + m.skip, end));
    if (parsed.ok) out.push({ person: m.person, numbers: parsed.value });
  });
  return out;
}

interface Week {
  school: string[];
  work: string[];
  training: Record<string, { days: number[]; time: TrainingTime }>;
  snacks: boolean;
}

type Line = { who: "assistant" | "admin"; text: string; key: string };

const QUESTIONS = [
  "Who eats at home? Names and ages are enough, for example “Omar 41, Sara 39, Layla 18, Zayd 10”.",
  "Who follows macro targets? Put each person's name before their numbers, in any format, for example “Omar 2150 cal, 180p 200c 70f”.",
  "What does a normal week look like? Tap what's true.",
  "What food does the family love? Tap any.",
  "Anything anyone must never eat? Allergies, religious rules or strong dislikes, for example “Zayd is allergic to sesame, no pork for anyone”.",
] as const;

const chip = (on: boolean) =>
  `min-h-11 rounded-full px-3 text-sm font-extrabold ${on ? "bg-basil-text text-paper" : "border-[1.5px] border-line-strong bg-card text-ink"}`;

function WeekPicker({
  people,
  week,
  onWeek,
}: {
  readonly people: readonly PersonAnswer[];
  readonly week: Week;
  readonly onWeek: (w: Week) => void;
}) {
  const names = people.map((p) => p.name);
  const toggle = (list: string[], n: string) =>
    list.includes(n) ? list.filter((x) => x !== n) : [...list, n];
  const row = (label: string, list: string[], set: (l: string[]) => void) => (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm font-extrabold">{label}</span>
      <div className="flex flex-wrap gap-2">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={list.includes(n)}
            className={chip(list.includes(n))}
            onClick={() => {
              set(toggle(list, n));
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      {row("Packed school lunch, Mon–Fri", week.school, (school) => {
        onWeek({ ...week, school });
      })}
      {row("Packed lunch for work, Mon–Fri", week.work, (work) => {
        onWeek({ ...week, work });
      })}
      {row("Trains", Object.keys(week.training), (list) => {
        const training: Week["training"] = {};
        for (const n of list)
          training[n] = week.training[n] ?? { days: [0, 2, 4], time: "evening" };
        onWeek({ ...week, training });
      })}
      {Object.entries(week.training).map(([n, t]) => (
        <div
          key={n}
          role="group"
          aria-label={`${n} trains on`}
          className="flex flex-wrap items-center gap-1.5 pl-2"
        >
          <span className="text-[13px] font-extrabold text-ink-soft">{n}:</span>
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={t.days.includes(i)}
              className={chip(t.days.includes(i))}
              onClick={() => {
                const days = t.days.includes(i)
                  ? t.days.filter((x) => x !== i)
                  : [...t.days, i].sort();
                onWeek({ ...week, training: { ...week.training, [n]: { ...t, days } } });
              }}
            >
              {d}
            </button>
          ))}
          {(["morning", "evening"] as const).map((time) => (
            <button
              key={time}
              type="button"
              aria-pressed={t.time === time}
              className={chip(t.time === time)}
              onClick={() => {
                onWeek({ ...week, training: { ...week.training, [n]: { ...t, time } } });
              }}
            >
              {time}
            </button>
          ))}
        </div>
      ))}
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
        <input
          type="checkbox"
          checked={week.snacks}
          onChange={(e) => {
            onWeek({ ...week, snacks: e.target.checked });
          }}
          className="size-[18px] accent-action"
        />
        We have snacks between meals
      </label>
    </div>
  );
}

function SetupProposal({
  answers,
  inferred,
  ctx,
  onCreate,
  busy,
}: {
  readonly answers: OnboardingAnswers;
  readonly inferred: InferredSetup;
  readonly ctx: Context;
  readonly onCreate: () => void;
  readonly busy: boolean;
}) {
  const people = answers.people ?? [];
  const numbers = new Map((answers.targets ?? []).map((t) => [t.person, t.numbers]));
  const training = new Map((answers.week?.training ?? []).map((t) => [t.person, t]));
  const notes = (n: string) =>
    [
      answers.week?.work?.people.includes(n) === true ? "Packed work lunch" : null,
      answers.week?.school?.people.includes(n) === true ? "School lunch" : null,
      ...(answers.neverEat ?? [])
        .filter((x) => x.who === n || x.who === "everyone")
        .map((x) => `Never ${x.term}${x.reason === "allergy" ? " (allergy)" : ""}`),
    ].filter((x): x is string => x !== null);
  const liked = (answers.cuisines ?? [])
    .map((k) => ctx.cuisines.find((cu) => cu.key === k)?.label ?? k)
    .join(" · ");
  return (
    <div
      className="flex flex-col gap-3.5 rounded-2xl border-2 border-agent bg-card p-[18px]"
      data-card="setup_proposal"
    >
      <div className="flex items-center gap-2.5">
        <span className="rounded-full bg-aubergine-tint px-2.5 py-0.5 text-xs font-extrabold text-aubergine-text">
          SETUP PROPOSAL
        </span>
        <span className="font-extrabold">
          {people.length === 0 ? "Your household" : `${String(people.length)} people`}
        </span>
      </div>
      {people.length > 0 && (
        <div className="max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-extrabold text-ink-soft">
                <th scope="col" className="py-1 pr-3">
                  PERSON
                </th>
                <th scope="col" className="py-1 pr-3">
                  TARGETS
                </th>
                <th scope="col" className="py-1 pr-3">
                  TRAINING
                </th>
                <th scope="col" className="py-1">
                  NOTES
                </th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const t = numbers.get(p.name);
                const tr = training.get(p.name);
                const note = notes(p.name);
                return (
                  <tr key={p.name} className="border-t border-line align-top">
                    <th scope="row" className="py-1.5 pr-3 text-left font-extrabold">
                      {p.name}
                      {p.age === null ? "" : `, ${String(p.age)}`}
                    </th>
                    <td className="py-1.5 pr-3 tabular">
                      {t === undefined ? (
                        <span className="font-body text-ink-soft">none</span>
                      ) : (
                        `${String(t.kcal)} · P${String(t.proteinG)} C${String(t.carbsG)} F${String(t.fatG)}`
                      )}
                    </td>
                    <td className="py-1.5 pr-3">
                      {tr === undefined
                        ? ""
                        : `${tr.weekdays.map((d) => DAYS[d]).join(", ")} · ${tr.time}`}
                    </td>
                    <td
                      className={`py-1.5 ${note.some((x) => x.includes("allergy")) ? "font-extrabold text-pomegranate-text" : ""}`}
                    >
                      {note.join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {liked !== "" && (
        <span className="self-start rounded-full bg-basil-tint px-2.5 py-1 text-[13px] font-extrabold text-basil-text">
          Likes: {liked}
        </span>
      )}
      <ul className="m-0 flex flex-col gap-1 pl-5 text-sm">
        {inferred.explanations.map((e, i) => (
          <li key={`${String(e.answer)}-${String(i)}`}>{e.text}</li>
        ))}
      </ul>
      {inferred.unresolved.length > 0 && (
        <span className="text-[13px] text-ink-soft">
          Not in the food list, so not saved:{" "}
          {inferred.unresolved.map((u) => `“${u.term}”`).join(", ")}.
        </span>
      )}
      <span className="text-[13px] text-ink-soft">
        Nothing is saved until you confirm. It is one change you can undo.
      </span>
      <div className="flex flex-wrap gap-2">
        <Button loading={busy} onClick={onCreate}>
          Create all &amp; plan tomorrow
        </Button>
        <LinkButton href="/onboarding" variant="secondary">
          Edit in the form
        </LinkButton>
      </div>
    </div>
  );
}

function Setup({ ctx, adminName }: { readonly ctx: Context; readonly adminName: string }) {
  const [step, setStep] = useState(0);
  const [lines, setLines] = useState<Line[]>([
    {
      who: "assistant",
      key: "hello",
      text: `Hi ${adminName}. Five quick questions, and I'll work out the rest. Skip any you like. Nothing is saved until you confirm.`,
    },
    { who: "assistant", key: "q0", text: QUESTIONS[0] },
  ]);
  const [text, setText] = useState("");
  const [people, setPeople] = useState<PersonAnswer[] | null>(null);
  const [targets, setTargets] = useState<{ person: string; numbers: TargetNumbers }[] | null>(null);
  const [week, setWeek] = useState<Week>({ school: [], work: [], training: {}, snacks: true });
  const [weekSkipped, setWeekSkipped] = useState(false);
  const [cuisines, setCuisines] = useState<string[] | null>([]);
  const [never, setNever] = useState<OnboardingAnswers["neverEat"]>(null);
  const [phase, setPhase] = useState<"asking" | "saving" | "planning" | "planned" | "failed">(
    "asking",
  );
  const [error, setError] = useState<string | null>(null);
  const [savedExplanations, setSavedExplanations] = useState<InferredSetup["explanations"] | null>(
    null,
  );
  const ids = useRef<string[]>([]);
  const names = (people ?? []).map((p) => p.name);

  const say = (who: Line["who"], t: string) => {
    setLines((l) => [...l, { who, text: t, key: `${who}-${String(l.length)}` }]);
  };

  const answers: OnboardingAnswers = {
    people,
    targets: people === null ? null : targets,
    week:
      step <= 2 || weekSkipped
        ? null
        : {
            school: week.school.length > 0 ? { people: week.school, weekdays: MON_FRI } : null,
            work: week.work.length > 0 ? { people: week.work, weekdays: MON_FRI } : null,
            training: Object.entries(week.training)
              .filter(([, t]) => t.days.length > 0)
              .map(([person, t]) => ({ person, weekdays: t.days, time: t.time })),
            snacks: week.snacks,
          },
    cuisines,
    neverEat: people === null ? null : never,
  };

  const inferred = useMemo((): InferredSetup | string => {
    if (step < 5) return "";
    try {
      let i = 0;
      return inferSetup(answers, {
        referenceYear: new Date().getFullYear(),
        adminName,
        slots: ctx.slots,
        cuisines: ctx.cuisines,
        ingredients: ctx.ingredients,
        satFatDefaultPct: ctx.satFatDefaultPct,
        newId: () => {
          ids.current[i] ??= newId();
          const id = ids.current[i] as string;
          i += 1;
          return id;
        },
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    // `answers` is rebuilt every render from the state below.
  }, [step, people, targets, week, weekSkipped, cuisines, never, ctx, adminName]);

  function answer(skip: boolean) {
    const reply = text.trim();
    if (!skip && reply === "" && step !== 2 && step !== 3) return;
    if (step === 0) {
      const parsed = skip ? [] : parsePeople(reply);
      say("admin", skip ? "Skip" : reply);
      setPeople(parsed.length === 0 ? null : parsed);
      say(
        "assistant",
        parsed.length === 0
          ? "No problem. I'll set things up for you alone to start with."
          : `Got it: ${parsed.map((p) => (p.age === null ? p.name : `${p.name} (${String(p.age)})`)).join(", ")}.`,
      );
    } else if (step === 1) {
      const found = skip ? [] : targetsByPerson(reply, names, adminName);
      say("admin", skip ? "Skip" : reply);
      setTargets(skip ? null : found);
      say(
        "assistant",
        found.length === 0
          ? "Nobody tracks targets for now; portions follow appetite and age."
          : `Targets for ${found.map((f) => `${f.person} (${String(f.numbers.kcal)} kcal)`).join(", ")}.`,
      );
    } else if (step === 2) {
      setWeekSkipped(skip);
      say("admin", skip ? "Skip" : "Done");
    } else if (step === 3) {
      if (skip) setCuisines(null);
      say(
        "admin",
        skip || cuisines === null || cuisines.length === 0
          ? "Skip"
          : cuisines.map((k) => ctx.cuisines.find((cu) => cu.key === k)?.label ?? k).join(", "),
      );
    } else {
      say("admin", skip ? "Skip" : reply);
      setNever(skip || reply === "" ? null : parseNeverEat(reply, names));
      say("assistant", "Here's what I understood. Nothing is saved until you confirm.");
    }
    setText("");
    const next = step + 1;
    if (next < 5) say("assistant", QUESTIONS[next] ?? "");
    setStep(next);
  }

  async function create() {
    if (typeof inferred === "string") return;
    setPhase("saving");
    setError(null);
    try {
      await applyChanges("Household set up by conversation", inferred.changeOps);
      setSavedExplanations(inferred.explanations);
    } catch (e) {
      setError(problemText(e));
      setPhase("failed");
      return;
    }
    setPhase("planning");
    try {
      const { jobId } = await api.call(c.plansGenerate, {
        body: { dates: [tomorrowIn(ctx.timezone)] },
      });
      for await (const ev of api.events(c.jobsEvents, { params: { id: jobId } })) {
        if (ev.type === "done") {
          setPhase("planned");
          return;
        }
        if (ev.type === "failed" || ev.type === "cancelled") break;
      }
      setError(
        "The plan could not be made. Your household is saved; plan tomorrow from the Plan screen.",
      );
      setPhase("failed");
    } catch (e) {
      setError(problemText(e));
      setPhase("failed");
    }
  }

  const asking = step < 5 && phase === "asking";
  const textQuestion = step === 0 || step === 1 || step === 4;
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-agent text-on-agent">
          <Icon name="assistant" size={22} />
        </span>
        <h1 className="text-2xl">Set up with the assistant</h1>
        <Link href="/onboarding" className="ml-auto font-extrabold">
          Use the form instead
        </Link>
      </div>
      <div
        role="log"
        aria-live="polite"
        aria-label="Set-up conversation"
        className="flex flex-col gap-3.5"
      >
        {lines.map((l) =>
          l.who === "assistant" ? (
            <p key={l.key} className="m-0 max-w-[640px] text-[15px] leading-normal">
              {l.text}
            </p>
          ) : (
            <p
              key={l.key}
              className="m-0 max-w-[640px] self-end rounded-[18px] rounded-br-[4px] bg-ink px-4 py-3.5 text-[15px] leading-normal text-paper"
            >
              {l.text}
            </p>
          ),
        )}
        {asking && step === 2 && <WeekPicker people={people ?? []} week={week} onWeek={setWeek} />}
        {asking && step === 3 && (
          <div role="group" aria-label="Cuisines the family loves" className="flex flex-wrap gap-2">
            {ctx.cuisines.map((cu) => {
              const on = cuisines?.includes(cu.key) === true;
              return (
                <button
                  key={cu.key}
                  type="button"
                  aria-pressed={on}
                  className={chip(on)}
                  onClick={() => {
                    setCuisines((l) => {
                      const list = l ?? [];
                      return on ? list.filter((k) => k !== cu.key) : [...list, cu.key];
                    });
                  }}
                >
                  {cu.label}
                </button>
              );
            })}
          </div>
        )}
        {step >= 5 && typeof inferred === "string" && inferred !== "" && (
          <p role="alert" className="m-0 font-bold text-pomegranate-text">
            {inferred}
          </p>
        )}
        {step >= 5 && typeof inferred !== "string" && phase !== "planned" && (
          <SetupProposal
            answers={answers}
            inferred={inferred}
            ctx={ctx}
            onCreate={() => void create()}
            busy={phase === "saving" || phase === "planning"}
          />
        )}
        {phase === "planning" && (
          <p role="status" className="m-0 font-bold text-ink-soft">
            Saved. Planning tomorrow…
          </p>
        )}
        {phase === "planned" && (
          <div className="flex flex-col gap-3" data-planned>
            <p className="m-0 text-[15px] font-bold text-basil-text">
              Saved, and tomorrow is planned.
            </p>
            {savedExplanations !== null && (
              <ul className="m-0 flex flex-col gap-1 pl-5 text-sm">
                {savedExplanations.map((e, i) => (
                  <li key={`${e.href}-${String(i)}`}>
                    {e.text} <Link href={e.href}>Adjust</Link>
                  </li>
                ))}
              </ul>
            )}
            <LinkButton href="/plan" className="self-start">
              Open tomorrow&apos;s plan
            </LinkButton>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="m-0 font-bold text-pomegranate-text">
            {error}
          </p>
        )}
      </div>
      {asking && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            answer(false);
          }}
        >
          {textQuestion ? (
            <div className="flex items-center gap-2.5 rounded-[18px] border-2 border-agent bg-card py-2 pr-2 pl-4">
              <label className="flex grow">
                <span className="sr-only">Your answer</span>
                <input
                  type="text"
                  value={text}
                  maxLength={2000}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                  className="min-h-10 grow border-none bg-transparent text-base text-ink outline-none"
                />
              </label>
              <button
                type="submit"
                aria-label="Send"
                disabled={text.trim() === ""}
                className="flex size-11 items-center justify-center rounded-md bg-agent text-on-agent disabled:opacity-60"
              >
                <Icon name="arrowRight" strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <Button type="submit" className="self-start">
              Done
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() => {
              answer(true);
            }}
          >
            Skip this question
          </Button>
        </form>
      )}
    </div>
  );
}

/** `/chat/setup`: for an admin of a household with no members yet. */
export function ChatOnboarding({ adminName }: { readonly adminName: string }) {
  const ctx = useLoad(loadContext);
  if (ctx.data === null)
    return ctx.error === null || ctx.loading ? (
      <SkeletonBlock label="Getting ready" lines={4} />
    ) : (
      <p role="alert" className="font-bold text-pomegranate-text">
        {ctx.error}
      </p>
    );
  if (ctx.data.existingMembers > 0)
    return (
      <div className="flex max-w-2xl flex-col gap-3 rounded-2xl bg-card p-6 shadow-card">
        <h1 className="text-3xl">Your household is already set up</h1>
        <p className="m-0 text-ink-soft">
          Change anything on the Family and Settings screens, or ask the assistant.
        </p>
        <LinkButton href="/chat" className="self-start">
          Open the assistant
        </LinkButton>
      </div>
    );
  return <Setup ctx={ctx.data} adminName={adminName} />;
}
