// The "Getting set up" checklist (R2-ONB-6; FirstDaysPhone.dc.html; leaf-1.4.7 SPEC-Q-10). Every
// item is derived from data the household already has; nothing is stored for the checklist.

export interface SetupFacts {
  activeMembers: number;
  planDays: number;
  /** A kitchen login, or an open kitchen invite. */
  kitchenInvited: boolean;
  reviews: number;
  /** A member-role login, or an open member invite. */
  familyInvited: boolean;
}

export type ChecklistKey = "family" | "first_plan" | "kitchen" | "rate" | "invite_family" | "questions";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
}

export interface Checklist {
  items: ChecklistItem[];
  done: number;
  total: number;
}

/** Meals to rate before "Rate your first 3 meals" is done. */
export const FIRST_RATINGS = 3;

export function checklist(
  facts: SetupFacts,
  questions: { answered: number; total: number },
): Checklist {
  const items: ChecklistItem[] = [
    { key: "family", label: "Family added", done: facts.activeMembers > 0 },
    { key: "first_plan", label: "First plan made", done: facts.planDays > 0 },
    { key: "kitchen", label: "Kitchen invited", done: facts.kitchenInvited },
    {
      key: "rate",
      label: `Rate your first ${String(FIRST_RATINGS)} meals (takes 2 taps each)`,
      done: facts.reviews >= FIRST_RATINGS,
    },
    { key: "invite_family", label: "Invite the family", done: facts.familyInvited },
  ];
  // Omitted when the configuration leaves nothing to ask.
  if (questions.total > 0)
    items.push({
      key: "questions",
      label: `Answer ${String(questions.total)} optional ${questions.total === 1 ? "question" : "questions"}`,
      done: questions.answered >= questions.total,
    });
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

/** "day N" of FirstDaysPhone: the household's first local day is day 1. */
export function setupDay(createdOn: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${createdOn}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}
