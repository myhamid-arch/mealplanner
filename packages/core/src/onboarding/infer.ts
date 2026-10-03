// inferSetup (R2-ONB-3): the confirmed five answers → the household configuration as change-set
// ops (AGT-6 registry) plus one explanation per inferred setting, each naming its source answer
// and where it is adjusted (R2-ONB-4, SC-7). Pure: no I/O, no clock; ids come from ctx.newId.
import type { ChangeOp } from "../changes/index.js";
import type { DietaryFlag, ExclusionReason } from "../types/index.js";
import { adjustHref, MEMBER_COLOR_ORDER } from "./explain.js";
import { appetiteForAge, isChild } from "./parse-people.js";
import { targetsText } from "./parse-targets.js";
import { resolveTerm } from "./resolve.js";
import { isSelfWord, listJoin, normalise, weekdayText } from "./text.js";
import type {
  AdjustTarget,
  DayTargets,
  Explanation,
  InferContext,
  InferredSetup,
  NeverEatItem,
  OnboardingAnswers,
  PersonAnswer,
  TrainingTime,
} from "./types.js";

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

/** Session times for the week card's morning / evening choice. */
export const TRAINING_TIMES: Readonly<Record<TrainingTime, string>> = {
  morning: "07:00:00",
  evening: "18:00:00",
};

/** The household cuisine preference onboarding writes (R2-ONB-3, FBK-4 cold start). */
export const CUISINE_LIKE_SCORE = 0.5;

/** Total fibre goal per 1,000 kcal and its soluble share (R-28, OQ-4). */
export const FIBRE_G_PER_1000_KCAL = 14;
export const SOLUBLE_SHARE = 0.25;
/** Marks a value the admin typed, as against one worked out (review explanations). */
const YOUR_NUMBER = "your number";

const REASON_RANK: Readonly<Record<ExclusionReason, number>> = {
  allergy: 5,
  medical: 4,
  religious: 3,
  other: 2,
  dislike: 1,
};

interface NewMember {
  id: string;
  person: PersonAnswer;
  targeted: boolean;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function inferSetup(answers: OnboardingAnswers, ctx: InferContext): InferredSetup {
  const ops: ChangeOp[] = [];
  const explanations: Explanation[] = [];
  const explain = (answer: Explanation["answer"], text: string, adjust: AdjustTarget) =>
    explanations.push({ answer, text, adjust, href: adjustHref(adjust) });

  const slotId = (key: string): string => {
    const slot = ctx.slots.find((s) => s.key === key);
    if (slot === undefined) throw new OnboardingError(`the household has no "${key}" slot`);
    return slot.id;
  };
  const slotActive = (key: string): boolean =>
    ctx.slots.find((s) => s.key === key)?.active ?? false;
  const activate = (key: string) => {
    if (!slotActive(key))
      ops.push({ kind: "slot.update", payload: { slotTypeId: slotId(key), active: true } });
  };

  // 1. Members ---------------------------------------------------------------------------------
  // "me (41)" is the admin (leaf-1.4.9 SPEC-Q-6): the member takes their name, and every answer
  // that says "me" means that member.
  const nameKey = (name: string): string => normalise(isSelfWord(name) ? ctx.adminName : name);
  const people: PersonAnswer[] =
    answers.people === null || answers.people.length === 0
      ? [{ name: ctx.adminName, age: null, sex: null }]
      : answers.people.map((p) => (isSelfWord(p.name) ? { ...p, name: ctx.adminName } : p));
  const lowerNames = people.map((p) => normalise(p.name));
  if (new Set(lowerNames).size !== lowerNames.length)
    throw new OnboardingError("two people have the same name");
  const targetedNames = new Set((answers.targets ?? []).map((t) => nameKey(t.person)));
  const members: NewMember[] = people.map((person) => ({
    id: ctx.newId(),
    person,
    targeted: targetedNames.has(normalise(person.name)),
  }));
  const byName = new Map(members.map((m) => [normalise(m.person.name), m]));
  const memberOf = (name: string): NewMember => {
    const m = byName.get(nameKey(name));
    if (m === undefined)
      throw new OnboardingError(`"${name}" is not one of the people in question 1`);
    return m;
  };
  members.forEach((m, i) => {
    ops.push({
      kind: "member.create",
      payload: {
        id: m.id,
        displayName: m.person.name,
        color: MEMBER_COLOR_ORDER[i % MEMBER_COLOR_ORDER.length] ?? "sea",
        birthYear: m.person.age === null ? null : ctx.referenceYear - m.person.age,
        sex: m.person.sex,
        isTargeted: m.targeted,
        appetite: appetiteForAge(m.person.age),
      },
    });
  });
  const first = members[0];
  if (first === undefined) throw new OnboardingError("no members");
  const children = members.filter((m) => isChild(m.person.age));
  const adults = members.length - children.length;
  if (answers.people === null || answers.people.length === 0) {
    explain(1, `One adult for now: ${first.person.name}. Add the rest of the family any time.`, {
      screen: "family",
    });
  } else {
    explain(
      1,
      `${count(adults, "adult")}${children.length > 0 ? `, ${count(children.length, "child", "children")}` : ""}`,
      { screen: "family" },
    );
    const untargeted = members.filter((m) => !m.targeted);
    if (untargeted.length > 0) {
      const groups = (["large", "medium", "small"] as const)
        .map((a) => ({
          a,
          names: untargeted
            .filter((m) => appetiteForAge(m.person.age) === a)
            .map((m) => m.person.name),
        }))
        .filter((g) => g.names.length > 0)
        .map((g) => `${listJoin(g.names)} ${g.a}`);
      explain(1, `Starting portions from age: ${groups.join(", ")}. They adjust from ratings.`, {
        screen: "member",
        memberId: (untargeted[0] ?? first).id,
        section: "profile",
      });
    }
  }

  // 2. Targets ----------------------------------------------------------------------------------
  const targeted = (answers.targets ?? []).map((t) => ({
    member: memberOf(t.person),
    numbers: t.numbers,
  }));
  for (const { member, numbers } of targeted) {
    const { training: trainingOwn, ...day } = numbers;
    const training = trainingOwn === undefined ? undefined : withDayExtras(trainingOwn, day);
    ops.push({
      kind: "target.set",
      payload: { memberId: member.id, kind: "default", profile: profile(day) },
    });
    if (training !== undefined)
      ops.push({
        kind: "target.set",
        payload: { memberId: member.id, kind: "training", profile: profile(training) },
      });
    explain(
      2,
      `${member.person.name} ${targetsText(day)} (total carbs).${training === undefined ? "" : ` Training days ${targetsText(training)}.`}`,
      { screen: "member", memberId: member.id, section: "targets" },
    );
  }
  const firstTargeted = targeted[0];
  if (firstTargeted === undefined) {
    explain(2, "No one follows macro targets. Portions come from appetite and ratings.", {
      screen: "family",
    });
  } else {
    explain(
      2,
      "Split across meals automatically. Each meal held to P ±5, C ±5, F ±2 g; calories within ±50 a day.",
      { screen: "member", memberId: firstTargeted.member.id, section: "meals" },
    );
    const satParts = targeted.map(({ member, numbers }) =>
      numbers.satFatMaxG === undefined
        ? `${String(Math.round(((ctx.satFatDefaultPct / 100) * numbers.kcal) / 9))} g for ${member.person.name} (${String(ctx.satFatDefaultPct)} % of calories)`
        : `${String(numbers.satFatMaxG)} g for ${member.person.name} (${YOUR_NUMBER})`,
    );
    explain(2, `Saturated fat capped at ${listJoin(satParts)}.`, {
      screen: "member",
      memberId: firstTargeted.member.id,
      section: "targets",
    });
    const fibreParts = targeted.map(({ member, numbers }) => {
      const total = numbers.fibreMinG ?? Math.round((FIBRE_G_PER_1000_KCAL * numbers.kcal) / 1000);
      const soluble = numbers.solubleFibreMinG ?? Math.round(total * SOLUBLE_SHARE);
      const totalSource =
        numbers.fibreMinG === undefined
          ? `${String(FIBRE_G_PER_1000_KCAL)} g per 1,000 kcal`
          : YOUR_NUMBER;
      const solubleSource =
        numbers.solubleFibreMinG === undefined
          ? `${String(Math.round(SOLUBLE_SHARE * 100))} % of fibre`
          : YOUR_NUMBER;
      return `${member.person.name} ${String(total)} g (${totalSource}), ${String(soluble)} g soluble (${solubleSource})`;
    });
    explain(2, `Fibre goals: ${listJoin(fibreParts)}.`, {
      screen: "member",
      memberId: firstTargeted.member.id,
      section: "targets",
    });
  }

  // 3. Week -------------------------------------------------------------------------------------
  const week = answers.week;
  /** member id → slot key → weekday → attends */
  const attendance = new Map<string, Map<string, Map<number, boolean>>>();
  const attend = (memberId: string, slot: string, days: readonly number[], attends: boolean) => {
    const bySlot = attendance.get(memberId) ?? new Map<string, Map<number, boolean>>();
    attendance.set(memberId, bySlot);
    const byDay = bySlot.get(slot) ?? new Map<number, boolean>();
    bySlot.set(slot, byDay);
    for (const d of days) byDay.set(d, attends);
  };
  const packed = (slot: string, card: { people: string[]; weekdays: number[] }) => {
    activate(slot);
    const named = new Set(card.people.map((p) => memberOf(p).id));
    const off = ALL_DAYS.filter((d) => !card.weekdays.includes(d));
    for (const m of members) {
      if (named.has(m.id)) {
        attend(m.id, slot, card.weekdays, true);
        attend(m.id, slot, off, false);
        attend(m.id, "lunch", card.weekdays, false); // PLN-3: replaces lunch on those days
      } else {
        attend(m.id, slot, ALL_DAYS, false);
      }
    }
  };
  if (week === null) {
    explain(3, "Breakfast, lunch, dinner and a snack every day.", {
      screen: "schedule",
      slotKey: "breakfast",
    });
  } else {
    if (week.school !== null && week.school.people.length > 0) {
      packed("packed_school_lunch", week.school);
      explain(
        3,
        `Packed school lunch ${weekdayText(week.school.weekdays)} for ${peopleText(week.school.people)}: shared, eaten cold, replaces lunch.`,
        { screen: "schedule", slotKey: "packed_school_lunch" },
      );
    }
    if (week.work !== null && week.work.people.length > 0) {
      packed("packed_work_lunch", week.work);
      // R2-ONB-3: work lunch is individual (SPEC-Q-2).
      ops.push({
        kind: "slot.update",
        payload: { slotTypeId: slotId("packed_work_lunch"), isShared: false },
      });
      explain(
        3,
        `Packed work lunch ${weekdayText(week.work.weekdays)} for ${peopleText(week.work.people)}: individual, microwave available, replaces lunch.`,
        { screen: "schedule", slotKey: "packed_work_lunch" },
      );
    }
    const training = new Map<string, { member: NewMember; days: Map<number, TrainingTime> }>();
    for (const card of week.training) {
      const member = memberOf(card.person);
      const entry = training.get(member.id) ?? { member, days: new Map<number, TrainingTime>() };
      training.set(member.id, entry);
      for (const d of card.weekdays) entry.days.set(d, card.time);
    }
    if (training.size > 0) {
      activate("pre_workout");
      activate("post_workout");
    }
    for (const { member, days } of training.values()) {
      const sorted = [...days.entries()].sort(([a], [b]) => a - b);
      ops.push({
        kind: "training.set",
        payload: {
          memberId: member.id,
          days: sorted.map(([weekday, time]) => ({
            weekday,
            sessionTime: TRAINING_TIMES[time],
            intensity: null,
          })),
        },
      });
      const times = [...new Set(sorted.map(([, t]) => t))];
      explain(
        3,
        `${member.person.name} trains ${weekdayText(sorted.map(([d]) => d))} (${times.map((t) => `${t}, ${TRAINING_TIMES[t].slice(0, 5)}`).join("; ")}): pre- and post-workout meals on those days. Same daily totals.`,
        { screen: "member", memberId: member.id, section: "training" },
      );
    }
    if (!week.snacks) {
      if (slotActive("snack"))
        ops.push({ kind: "slot.update", payload: { slotTypeId: slotId("snack"), active: false } });
      explain(3, "No snacks between meals.", { screen: "schedule", slotKey: "snack" });
    } else {
      activate("snack");
      explain(3, "A snack between meals every day.", { screen: "schedule", slotKey: "snack" });
    }
  }
  for (const [memberId, bySlot] of attendance) {
    for (const [slot, byDay] of bySlot) {
      ops.push({
        kind: "slot_schedule.set",
        payload: {
          memberId,
          slotTypeId: slotId(slot),
          days: [...byDay.entries()]
            .sort(([a], [b]) => a - b)
            .map(([weekday, attends]) => ({ weekday, attends })),
        },
      });
    }
  }

  // 4. Cuisines ---------------------------------------------------------------------------------
  const cuisines = answers.cuisines ?? [];
  const labels: string[] = [];
  for (const key of new Set(cuisines)) {
    const cuisine = ctx.cuisines.find((c) => c.key === key);
    if (cuisine === undefined) throw new OnboardingError(`unknown cuisine "${key}"`);
    labels.push(cuisine.label);
    ops.push({
      kind: "preference.set",
      payload: {
        memberId: null,
        entityType: "cuisine",
        entityKey: key,
        score: CUISINE_LIKE_SCORE,
        source: "explicit",
      },
    });
  }
  explain(
    4,
    labels.length === 0
      ? "No favourite cuisines yet: tastes are learned from ratings."
      : `First weeks lean on ${listJoin(labels)} dishes.`,
    { screen: "tastes", section: "cuisines" },
  );

  // 5. Never eat --------------------------------------------------------------------------------
  interface Rule {
    memberId: string | null;
    who: string;
    kind: "dietary_flag" | "category" | "ingredient";
    key: string;
    reason: ExclusionReason;
    term: string;
    covers: string[];
  }
  const rules = new Map<string, Rule>();
  const coverage: InferredSetup["coverage"] = [];
  const unresolved: NeverEatItem[] = [];
  const names = new Map(ctx.ingredients.map((i) => [i.slug, i.name]));
  const categoryOf = new Map(ctx.ingredients.map((i) => [i.slug, i.category]));
  for (const item of answers.neverEat ?? []) {
    const everyone = normalise(item.who) === "everyone";
    const member = everyone ? null : memberOf(item.who);
    const resolution = resolveTerm(item.term, ctx.ingredients);
    if (resolution.kind === "unknown") {
      unresolved.push(item);
      continue;
    }
    const entries: { kind: Rule["kind"]; key: string; covers: string[] }[] =
      resolution.kind === "dietary_flag"
        ? [{ kind: "dietary_flag", key: resolution.flag, covers: resolution.slugs }]
        : resolution.kind === "category"
          ? resolution.categories.map((category) => ({
              kind: "category" as const,
              key: category,
              covers: resolution.slugs.filter((slug) => categoryOf.get(slug) === category),
            }))
          : resolution.slugs.map((slug) => ({
              kind: "ingredient" as const,
              key: slug,
              covers: [slug],
            }));
    for (const e of entries) {
      const id = `${member?.id ?? "*"}|${e.kind}|${e.key}`;
      const existing = rules.get(id);
      if (existing !== undefined && REASON_RANK[existing.reason] >= REASON_RANK[item.reason])
        continue;
      rules.set(id, {
        memberId: member?.id ?? null,
        who: everyone ? "Everyone" : (member?.person.name ?? ""),
        kind: e.kind,
        key: e.key,
        reason: item.reason,
        term: item.term,
        covers: e.covers,
      });
    }
  }
  for (const rule of rules.values()) {
    ops.push({
      kind: "exclusion.add",
      payload: {
        memberId: rule.memberId,
        kind: rule.kind,
        key: rule.key,
        reason: rule.reason,
        // R-34: every exclusion filters; `hard` only protects it against relaxing.
        hard: rule.reason !== "dislike",
      },
    });
    if (rule.kind === "dietary_flag")
      coverage.push({ memberId: rule.memberId, flag: rule.key as DietaryFlag, slugs: rule.covers });
  }
  // One explanation per (who, reason), in answer order.
  const groups = new Map<string, Rule[]>();
  for (const rule of rules.values()) {
    const id = `${rule.memberId ?? "*"}|${rule.reason}`;
    groups.set(id, [...(groups.get(id) ?? []), rule]);
  }
  for (const group of groups.values()) {
    const head = group[0];
    if (head === undefined) continue;
    const terms = [...new Set(group.map((r) => r.term))];
    // Allergies and medical rules name what the flag covers (R2-ONB-3: "sesame → tahini, hummus,
    // za'atar"); a household rule says it covers sauces and marinades instead. A group word
    // ("seafood", W-28) always names what it covers.
    const including = group
      .filter(
        (r) =>
          r.kind === "category" ||
          (r.kind === "dietary_flag" && (r.reason === "allergy" || r.reason === "medical")),
      )
      .flatMap((r) => r.covers)
      .map((slug) => names.get(slug) ?? slug)
      .filter((name) => !terms.some((t) => normalise(name).includes(normalise(t))));
    const ingredientNames = group
      .filter((r) => r.kind === "ingredient")
      .map((r) => names.get(r.key) ?? r.key);
    const what =
      group.every((r) => r.kind === "ingredient") && ingredientNames.length > 0
        ? listJoin(ingredientNames.map((n) => n.toLowerCase()))
        : listJoin(terms);
    const incl =
      including.length === 0
        ? ""
        : `, including ${listJoin(
            including.length > 4
              ? [
                  ...including.slice(0, 4).map((n) => n.toLowerCase()),
                  `${String(including.length - 4)} more`,
                ]
              : including.map((n) => n.toLowerCase()),
          )}`;
    const suffix =
      head.reason === "allergy"
        ? " Allergy: a hard rule."
        : head.reason === "religious"
          ? " Household rule, including in sauces and marinades."
          : head.reason === "medical"
            ? " Medical: a hard rule."
            : " Never planned for them.";
    explain(5, `${head.who}: never ${what}${incl}.${suffix}`, {
      screen: "tastes",
      section: "never-serve",
    });
  }
  if (rules.size === 0)
    explain(5, "Nothing is off the menu.", { screen: "tastes", section: "never-serve" });

  return {
    changeOps: ops,
    explanations,
    members: members.map((m) => ({ name: m.person.name, id: m.id })),
    coverage,
    unresolved,
  };
}

/**
 * Sat fat, soluble fibre, fibre and sodium typed once apply to training days too, unless the
 * training part gives its own value ("… sat fat 22 g. Training days: 2390 / 180 / 260 / 70").
 */
function withDayExtras(training: DayTargets, day: DayTargets): DayTargets {
  return {
    ...training,
    satFatMaxG: training.satFatMaxG ?? day.satFatMaxG,
    solubleFibreMinG: training.solubleFibreMinG ?? day.solubleFibreMinG,
    fibreMinG: training.fibreMinG ?? day.fibreMinG,
    sodiumMaxMg: training.sodiumMaxMg ?? day.sodiumMaxMg,
  };
}

function profile(t: DayTargets) {
  return {
    kcal: t.kcal,
    proteinG: t.proteinG,
    carbsG: t.carbsG,
    fatG: t.fatG,
    satFatMaxG: t.satFatMaxG ?? null,
    solubleFibreMinG: t.solubleFibreMinG ?? null,
    fibreMinG: t.fibreMinG ?? null,
    sodiumMaxMg: t.sodiumMaxMg ?? null,
  };
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

function peopleText(people: readonly string[]): string {
  return people.length >= 3
    ? `the ${String(people.length)} of them (${listJoin(people)})`
    : listJoin(people);
}
