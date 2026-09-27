"use client";
// Onboarding (R2-ONB-1 … 4; Onboarding.dc.html; SC-6, SC-7): five optional questions, a live
// "What I've worked out" panel, a review, then one change set and tomorrow's plan. Nothing is
// saved before "Looks right: plan tomorrow" (R2-ONB-4); before that, Adjust returns to the answer;
// afterwards it links to the screen where the setting lives (leaf-1.4.3 SPEC-Q-7).
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  inferSetup,
  parseNeverEat,
  parsePeople,
  parseTargets,
  resolveTerm,
  type Explanation,
  type InferredSetup,
  type NeverEatItem,
  type OnboardingAnswers,
  type TargetParse,
} from "@mealplanner/core/onboarding";
import { api, applyChanges, c, problemText, useLoad } from "../api";
import type { Cuisine, Ingredient, Slot } from "../data";
import { FLAG_LABEL } from "../never-serve";
import { ErrorBlock, LoadingBlock } from "../parts";
import {
  CuisineQuestion,
  defaultWeek,
  NeverQuestion,
  PeopleQuestion,
  TargetsQuestion,
  WeekQuestion,
  type WeekState,
} from "./questions";

const STEPS = ["Who", "Targets", "Week", "Food", "Never", "Review"] as const;

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

/** Tomorrow in the household's time zone (the first plan, US-3). */
export function tomorrowIn(timezone: string, now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Phase =
  | { kind: "questions" }
  | { kind: "saving" }
  | { kind: "planning"; events: number }
  | { kind: "planned"; date: string }
  | { kind: "failed"; message: string; saved: boolean };

export function OnboardingFlow({ adminName }: { readonly adminName: string }) {
  const ctx = useLoad(loadContext);
  if (ctx.data === null)
    return ctx.error === null || ctx.loading ? (
      <LoadingBlock label="Getting ready" />
    ) : (
      <ErrorBlock message={ctx.error} onRetry={() => void ctx.reload()} />
    );
  if (ctx.data.existingMembers > 0)
    return (
      <div className="flex max-w-2xl flex-col gap-3 rounded-2xl bg-card p-6 shadow-card">
        <h1 className="text-3xl">Your household is already set up</h1>
        <p className="m-0 text-ink-soft">
          {ctx.data.existingMembers} {ctx.data.existingMembers === 1 ? "person is" : "people are"}{" "}
          in the family. Change anything on the Family and Settings screens, or tell the assistant.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/family" className="font-extrabold">
            Family
          </Link>
          <Link href="/settings" className="font-extrabold">
            Settings
          </Link>
        </div>
      </div>
    );
  return <Flow ctx={ctx.data} adminName={adminName} />;
}

function Flow({ ctx, adminName }: { readonly ctx: Context; readonly adminName: string }) {
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [peopleText, setPeopleText] = useState("");
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  const [targetTexts, setTargetTexts] = useState<Record<string, string>>({});
  const [week, setWeek] = useState<WeekState | null>(null);
  const [cuisines, setCuisines] = useState<ReadonlySet<string>>(new Set());
  const [showAllCuisines, setShowAllCuisines] = useState(false);
  const [neverText, setNeverText] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "questions" });
  const [confirmed, setConfirmed] = useState<InferredSetup | null>(null);
  const ids = useRef<string[]>([]);

  const people = useMemo(() => parsePeople(peopleText), [peopleText]);
  const names = people.map((p) => p.name);
  const parses: Record<string, TargetParse> = useMemo(
    () => Object.fromEntries(Object.entries(targetTexts).map(([n, t]) => [n, parseTargets(t)])),
    [targetTexts],
  );
  const weekState = week ?? defaultWeek(people);
  const namesKey = names.join("\u0000");
  const neverItems = useMemo(
    () => parseNeverEat(neverText, namesKey === "" ? [] : namesKey.split("\u0000")),
    [neverText, namesKey],
  );

  const answers: OnboardingAnswers = {
    people: skipped.has(0) || people.length === 0 ? null : people,
    targets:
      skipped.has(1) || people.length === 0
        ? null
        : names
            .filter((n) => tapped.has(n))
            .flatMap((n) => {
              const p = parses[n];
              return p?.ok === true ? [{ person: n, numbers: p.value }] : [];
            }),
    week:
      skipped.has(2) || step < 2
        ? null
        : {
            school:
              weekState.school.on &&
              weekState.school.people.length > 0 &&
              weekState.school.days.length > 0
                ? {
                    people: weekState.school.people.filter((n) => names.includes(n)),
                    weekdays: weekState.school.days,
                  }
                : null,
            work:
              weekState.work.on &&
              weekState.work.people.length > 0 &&
              weekState.work.days.length > 0
                ? {
                    people: weekState.work.people.filter((n) => names.includes(n)),
                    weekdays: weekState.work.days,
                  }
                : null,
            training: Object.entries(weekState.training)
              .filter(([n, t]) => t.on && t.days.length > 0 && names.includes(n))
              .map(([person, t]) => ({ person, weekdays: t.days, time: t.time })),
            snacks: weekState.snacks,
          },
    cuisines: skipped.has(3) ? null : [...cuisines],
    neverEat: skipped.has(4) || people.length === 0 ? null : neverItems,
  };

  let inferred: InferredSetup | null = null;
  let inferError: string | null = null;
  try {
    let i = 0;
    inferred = inferSetup(answers, {
      referenceYear: new Date().getFullYear(),
      adminName,
      slots: ctx.slots,
      cuisines: ctx.cuisines,
      ingredients: ctx.ingredients,
      satFatDefaultPct: ctx.satFatDefaultPct,
      newId: () => {
        ids.current[i] ??= crypto.randomUUID();
        const id = ids.current[i] as string;
        i += 1;
        return id;
      },
    });
  } catch (e) {
    inferError = e instanceof Error ? e.message : String(e);
  }

  const describe = (item: NeverEatItem) => {
    const r = resolveTerm(item.term, ctx.ingredients);
    const who = item.who === "everyone" ? "Everyone" : item.who;
    if (r.kind === "unknown")
      return `${who}: “${item.term}” is not in the catalogue, so it is not saved.`;
    const what =
      r.kind === "dietary_flag"
        ? `anything with ${FLAG_LABEL[r.flag] ?? r.flag} (${String(r.slugs.length)} foods)`
        : r.slugs
            .map((s) => ctx.ingredients.find((i) => i.slug === s)?.name.toLowerCase() ?? s)
            .join(", ");
    return `${who}: never ${what} · ${item.reason}`;
  };

  const next = () => {
    const nextSkipped = new Set(skipped);
    nextSkipped.delete(step);
    setSkipped(nextSkipped);
    if (step === 1 && week === null) setWeek(defaultWeek(people));
    setStep(Math.min(5, step + 1));
  };
  const skip = () => {
    setSkipped(new Set([...skipped, step]));
    if (step === 1 && week === null) setWeek(defaultWeek(people));
    setStep(Math.min(5, step + 1));
  };

  const confirm = async () => {
    if (inferred === null) return;
    setPhase({ kind: "saving" });
    const date = tomorrowIn(ctx.timezone);
    try {
      await applyChanges("Household set up from onboarding", inferred.changeOps);
      setConfirmed(inferred);
    } catch (e) {
      setPhase({ kind: "failed", message: problemText(e), saved: false });
      return;
    }
    await planTomorrow(date);
  };
  const planTomorrow = async (date: string) => {
    setPhase({ kind: "planning", events: 0 });
    try {
      const { jobId } = await api.call(c.plansGenerate, { body: { dates: [date] } });
      let events = 0;
      for await (const event of api.events(c.jobsEvents, { params: { id: jobId } })) {
        events += 1;
        if (event.type === "done") {
          setPhase({ kind: "planned", date });
          return;
        }
        if (event.type === "failed" || event.type === "cancelled") {
          setPhase({
            kind: "failed",
            message: "The plan could not be made. Your setup is saved; try planning again.",
            saved: true,
          });
          return;
        }
        setPhase({ kind: "planning", events });
      }
      setPhase({
        kind: "failed",
        message: "Lost contact while planning. Your setup is saved; try again.",
        saved: true,
      });
    } catch (e) {
      setPhase({ kind: "failed", message: problemText(e), saved: true });
    }
  };

  const done = phase.kind !== "questions" && phase.kind !== "saving" && confirmed !== null;
  const shownExplanations =
    (confirmed ?? inferred)?.explanations.filter(
      (e) => done || step === 5 || e.answer - 1 < step,
    ) ?? [];
  const firstTargeted = confirmed?.members.find((m) =>
    answers.targets?.some((t) => t.person === m.name),
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <ol aria-label="Progress" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((label, i) => {
            const state = done ? "done" : i === step ? "current" : i < step ? "done" : "todo";
            return (
              <li
                key={label}
                aria-current={state === "current" ? "step" : undefined}
                className={`rounded-full px-3 py-1.5 text-[13px] font-extrabold ${
                  state === "current"
                    ? "bg-action text-on-action"
                    : state === "done"
                      ? "bg-basil-tint text-basil-text"
                      : "bg-flour text-ink-soft"
                }`}
              >
                {i < 5 ? `${String(i + 1)} ` : ""}
                {label}
              </li>
            );
          })}
        </ol>
        <Link
          href={`/chat?prompt=${encodeURIComponent("Set up my household: ")}`}
          className="ml-auto text-sm font-extrabold"
        >
          Rather just talk? Tell the assistant
        </Link>
      </div>
      <div className="flex flex-col gap-7 lg:flex-row">
        <div
          className="flex min-w-0 grow flex-col gap-4"
          data-onboarding-step={done ? "planned" : String(step)}
        >
          {done || phase.kind === "saving" ? (
            <Result
              phase={phase}
              onRetry={() => void planTomorrow(tomorrowIn(ctx.timezone))}
              firstTargetedId={firstTargeted?.id ?? null}
            />
          ) : (
            <>
              {step === 0 && (
                <PeopleQuestion
                  text={peopleText}
                  onText={(t) => {
                    setPeopleText(t);
                    setWeek(null);
                  }}
                  people={people}
                  error={inferError}
                />
              )}
              {step === 1 &&
                (people.length === 0 ? (
                  <p className="m-0 text-ink-soft">
                    Nobody is listed in question 1, so there is no one to give targets to. Skip, or
                    go back.
                  </p>
                ) : (
                  <TargetsQuestion
                    people={people}
                    tapped={tapped}
                    onTap={(n) => {
                      const t = new Set(tapped);
                      if (t.has(n)) t.delete(n);
                      else t.add(n);
                      setTapped(t);
                    }}
                    texts={targetTexts}
                    onText={(n, text) => {
                      setTargetTexts({ ...targetTexts, [n]: text });
                    }}
                    parses={parses}
                  />
                ))}
              {step === 2 && (
                <WeekQuestion
                  people={
                    people.length === 0 ? [{ name: adminName, age: null, sex: null }] : people
                  }
                  week={weekState}
                  onWeek={setWeek}
                />
              )}
              {step === 3 && (
                <CuisineQuestion
                  cuisines={ctx.cuisines}
                  chosen={cuisines}
                  onToggle={(k) => {
                    const s = new Set(cuisines);
                    if (s.has(k)) s.delete(k);
                    else s.add(k);
                    setCuisines(s);
                  }}
                  showAll={showAllCuisines}
                  onShowAll={() => {
                    setShowAllCuisines(true);
                  }}
                />
              )}
              {step === 4 && (
                <NeverQuestion
                  text={neverText}
                  onText={setNeverText}
                  items={neverItems}
                  describe={describe}
                />
              )}
              {step === 5 && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-extrabold text-basil-text">DONE · 5 ANSWERS</span>
                    <h1 className="text-[30px] sm:text-[36px]">Here&apos;s what I worked out</h1>
                    <p className="m-0 text-ink-soft">
                      Everything on the right came from your 5 answers. Adjust anything now, or
                      later. Nothing here is saved until you say it looks right.
                    </p>
                  </div>
                  {inferred !== null && inferred.unresolved.length > 0 && (
                    <p className="m-0 rounded-xl bg-saffron-tint p-3 font-bold text-saffron-text">
                      Not saved, because the catalogue has no match:{" "}
                      {inferred.unresolved.map((u) => `“${u.term}”`).join(", ")}. Add them later
                      under Family › Allergies &amp; never-serve.
                    </p>
                  )}
                  {inferError !== null && (
                    <p role="alert" className="m-0 font-bold text-pomegranate-text">
                      {inferError}
                    </p>
                  )}
                </>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep(step - 1);
                    }}
                    className="min-h-13 rounded-xl border-[1.5px] border-ink bg-card px-5 font-extrabold text-ink"
                  >
                    Back
                  </button>
                )}
                {step < 5 ? (
                  <>
                    <button
                      type="button"
                      onClick={next}
                      className="min-h-13 rounded-xl bg-action px-6 text-base font-extrabold text-on-action"
                    >
                      {step === 4 ? "See what I worked out" : "Next"}
                    </button>
                    <button
                      type="button"
                      onClick={skip}
                      className="min-h-13 px-3 font-extrabold text-ink-soft"
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={inferred === null}
                    onClick={() => void confirm()}
                    className="min-h-13 rounded-xl bg-action px-6 text-base font-extrabold text-on-action"
                  >
                    Looks right: plan tomorrow
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <WorkedOut
          explanations={shownExplanations}
          saved={done}
          onAdjust={(e) => {
            setStep(e.answer - 1);
          }}
        />
      </div>
    </div>
  );
}

function WorkedOut({
  explanations,
  saved,
  onAdjust,
}: {
  readonly explanations: readonly Explanation[];
  readonly saved: boolean;
  readonly onAdjust: (e: Explanation) => void;
}) {
  return (
    <aside
      aria-label="What the app has worked out"
      className="flex shrink-0 flex-col gap-3 self-start rounded-3xl bg-rail p-5 text-rail-ink lg:w-[440px]"
    >
      <h2 className="text-[22px] text-rail-ink-strong">What I&apos;ve worked out</h2>
      <p className="m-0 text-[13px]">
        {saved
          ? "Saved. Adjust opens the screen where each setting lives."
          : "Updates as you answer. Tap Adjust to change any of it."}
      </p>
      {explanations.length === 0 ? (
        <p className="m-0 rounded-xl bg-rail-raised p-3.5 text-sm text-rail-ink-strong">
          Nothing yet. Answer the first question.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
          {explanations.map((e, i) => (
            <li
              key={`${String(e.answer)}-${String(i)}`}
              className="flex items-start gap-2.5 rounded-xl bg-rail-raised px-3.5 py-3"
              data-explanation={e.adjust.screen}
            >
              <span className="flex grow flex-col gap-0.5">
                <span className="text-[11px] font-extrabold tracking-wider text-rail-ink-muted">
                  FROM ANSWER {e.answer}
                </span>
                <span className="text-sm leading-snug text-rail-ink-strong">{e.text}</span>
              </span>
              {saved ? (
                <Link
                  href={e.href}
                  className="shrink-0 text-[13px] font-extrabold text-rail-ink-strong underline hover:text-rail-ink-strong"
                  data-adjust={e.href}
                >
                  Adjust
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onAdjust(e);
                  }}
                  className="min-h-11 shrink-0 px-1 text-[13px] font-extrabold text-rail-ink-strong underline"
                >
                  Adjust<span className="sr-only-focusable"> answer {e.answer}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function Result({
  phase,
  onRetry,
  firstTargetedId,
}: {
  readonly phase: Phase;
  readonly onRetry: () => void;
  readonly firstTargetedId: string | null;
}) {
  if (phase.kind === "saving" || phase.kind === "planning")
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3" data-planning>
        <h1 className="text-[30px] sm:text-[36px]">
          {phase.kind === "saving" ? "Saving your household…" : "Planning tomorrow…"}
        </h1>
        <p className="m-0 text-ink-soft">
          {phase.kind === "saving"
            ? "One change set, which you can undo from the change log."
            : "Choosing dishes and solving every plate. This takes a few seconds."}
        </p>
        <div className="h-2 w-64 overflow-hidden rounded-full bg-flour">
          <div className="h-full w-1/2 rounded-full bg-action skeleton-pulse" />
        </div>
      </div>
    );
  if (phase.kind === "failed")
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <h1 className="text-[30px]">
          {phase.saved ? "Your household is saved" : "That didn't work"}
        </h1>
        <p className="m-0 font-bold text-pomegranate-text">{phase.message}</p>
        {phase.saved && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-12 rounded-xl bg-action px-5 font-extrabold text-on-action"
          >
            Plan tomorrow
          </button>
        )}
      </div>
    );
  if (phase.kind !== "planned") return null;
  const deeper = [
    ...(firstTargetedId === null
      ? []
      : [
          {
            href: `/family/${firstTargetedId}#targets`,
            label: "Different targets on training days",
          },
        ]),
    { href: "/settings/schedule", label: "Meal times" },
    { href: "/family/me", label: "Taste swipe for each person" },
    { href: "/settings/planning", label: "Planning balance" },
  ];
  return (
    <div className="flex flex-col gap-4" data-planned={phase.date}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-extrabold text-basil-text">DONE · SAVED</span>
        <h1 className="text-[30px] sm:text-[36px]">Tomorrow is planned</h1>
        <p className="m-0 text-ink-soft">
          Everything on the right is saved as one change. Adjust anything now, or later. Nothing
          here is permanent.
        </p>
      </div>
      <div className="flex flex-col gap-2.5 rounded-2xl bg-card p-4 shadow-card">
        <span className="font-extrabold">Want to go deeper now? (optional)</span>
        <div className="flex flex-wrap gap-2">
          {deeper.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-full bg-flour px-3 py-2 text-sm font-extrabold text-ink no-underline hover:text-ink"
            >
              {d.label}
            </Link>
          ))}
        </div>
      </div>
      <Link
        href="/plan"
        className="flex min-h-13 w-fit items-center rounded-xl bg-action px-6 font-extrabold text-on-action no-underline hover:text-on-action"
      >
        Open tomorrow&apos;s plan
      </Link>
    </div>
  );
}
