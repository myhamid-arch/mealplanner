// AGT-3 context: the stable, cached system prompt (role, principles, apply vs propose, formatting,
// and the change-op reference) and the household digest appended to each user turn after the
// cached prefix.
import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { PUBLIC_OPS } from "@mealplanner/core/changes";
import { DIETARY_FLAGS } from "@mealplanner/core/types";

/** The dietary flags that name a food (R2-ONB-3: allergens expand through them). */
const FOOD_FLAGS = DIETARY_FLAGS.filter((f) => f.startsWith("contains_"));

export const SYSTEM_PROMPT = `You are this household's meal-planning assistant inside a family meal planner. You talk with an admin of the household: a parent who manages meals, macro targets, recipes and the family's settings. Kitchen staff cook from the plans; family members review meals.

Principles:
- Priorities come from the household's weights: macro precision first, then appeal, then ingredient economy. Say so when a request trades one against another.
- Never invent nutrition numbers, grams, targets or ids. Read them with tools (get_household, get_plan, explain_meal, get_dish, search_dishes) before you state or use them.
- Keep answers short. Show numbers in Markdown tables (member by slot, target against actual).
- Members are called by their names; the admin talks about people by name.

Changes:
- Every change is a set of change ops (reference below), applied through the app's change service, logged and undoable.
- Use apply_change only for a change the admin explicitly asked for in their current message ("set Sara's protein to 140 g"). Summarise it in plain words.
- Your own ideas, and anything the admin did not clearly ask for, go to propose_change with a title, a rationale and the evidence (review ids) behind it. The admin accepts or rejects it.
- Some changes are protected (relaxing an allergy exclusion, loosening a tolerance, archiving a member, retiring a dish with reviews, changing a role). The app turns them into a proposal even through apply_change; tell the admin it is waiting for their confirmation.
- An allergy is exclusion.add with reason "allergy" and hard true. When a dietary flag names the food (${FOOD_FLAGS.join(", ")}), exclude the flag: one exclusion.add with kind "dietary_flag" and the flag as key, which covers every catalogue ingredient carrying it (a sesame allergy is key "contains_sesame": sesame seeds, sesame oil, tahini, tahini halva, hummus and za'atar blend). Any other food is an ingredient exclusion whose key is the ingredient slug (for example "mushrooms"), never an ingredient id; check the slug with search_dishes or get_dish if unsure.
- Weekdays in ops are integers: 0 = Monday, 1 = Tuesday, 2 = Wednesday, 3 = Thursday, 4 = Friday, 5 = Saturday, 6 = Sunday.
- Weights for particular days of the week are a weights preset: preset.upsert with appliesToWeekdays.
- A role change (for example making someone an admin) is role.set with the login's userId from get_household (logins), sent through apply_change; it is protected, so it becomes a proposal the admin confirms. Invitations, blocking or removing a login, sign-out of sessions and support access are managed on the People & access screen, not by you.
- If an op is refused, read the error, fix the payload or explain the problem; do not retry the same op unchanged.

Jobs:
- generate_plan, create_recipe and run_insights start background jobs. Say that it has started; the result appears in this chat when it finishes.

Formatting for the chat:
- Markdown: short paragraphs, bullet lists and tables. No headings for short answers. No emoji.
- Do not repeat what a card already shows (applied changes, proposals, plans); refer to it.`;

/** A JSON Schema without its `$schema` dialect key (noise in a prompt or tool definition). */
export function withoutDialect(schema: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$schema"));
}

/** Ops the agent may send, with their protection and payload schema; sorted and byte-stable. */
export function opReference(): string {
  const lines = PUBLIC_OPS.filter(
    (op) => !op.kind.startsWith("access.") && !op.kind.startsWith("support."),
  )
    .map((op) => op.kind)
    .sort()
    .map((kind) => {
      const def = PUBLIC_OPS.find((op) => op.kind === kind);
      if (def === undefined) throw new Error(`unknown op ${kind}`);
      const protection =
        typeof def.protected === "function"
          ? "protected when relaxing"
          : def.protected
            ? "protected"
            : "not protected";
      const schema = withoutDialect(
        z.toJSONSchema(def.schema, { io: "input", unrepresentable: "any" }),
      );
      return `${kind} (${protection}): ${JSON.stringify(schema)}`;
    });
  return [
    'Change ops: each op is {"kind": <kind>, "payload": <object matching the schema>}.',
    ...lines,
  ].join("\n");
}

/** The system blocks; the breakpoint on the last one caches the tools and the whole system. */
export function systemBlocks(): BetaTextBlockParam[] {
  return [
    { type: "text", text: SYSTEM_PROMPT },
    { type: "text", text: opReference(), cache_control: { type: "ephemeral" } },
  ];
}

/** The compact household snapshot of AGT-3, built by the web adapter from the database. */
export interface DigestSnapshot {
  /** The household's local date and time. */
  now: string;
  timezone: string;
  members: {
    id: string;
    name: string;
    targeted: boolean;
    /** Default-day targets, when targeted. */
    targets?: { kcal: number; protein: number; carbs: number; fat: number } | null;
  }[];
  slots: { key: string; label: string; shared: boolean }[];
  weights: {
    macroPrecision: number;
    appeal: number;
    ingredientEconomy: number;
    aiGeneration: string;
  };
  pendingProposals: number;
  agentMayApply: boolean;
  today: { date: string; status: "planned" | "not planned"; meals: number };
}

/** The digest text block (AGT-3): appended last in each user turn. */
export function householdDigest(s: DigestSnapshot): string {
  const members = s.members
    .map((m) => {
      const t =
        m.targeted && m.targets
          ? `targeted ${String(m.targets.kcal)} kcal / P ${String(m.targets.protein)} / C ${String(m.targets.carbs)} / F ${String(m.targets.fat)}`
          : m.targeted
            ? "targeted"
            : "untargeted";
      return `- ${m.name} (id ${m.id}): ${t}`;
    })
    .join("\n");
  const slots = s.slots
    .map((x) => `${x.label} [${x.key}, ${x.shared ? "shared" : "individual"}]`)
    .join(", ");
  return [
    `Household digest (${s.now}, ${s.timezone}):`,
    "Members:",
    members === "" ? "- none" : members,
    `Active slots: ${slots === "" ? "none" : slots}`,
    `Weights: macro precision ${String(s.weights.macroPrecision)}, appeal ${String(s.weights.appeal)}, ingredient economy ${String(s.weights.ingredientEconomy)}; AI recipes ${s.weights.aiGeneration}`,
    `Pending proposals: ${String(s.pendingProposals)}`,
    `Assistant may apply requested changes: ${s.agentMayApply ? "yes" : "no (every change becomes a proposal)"}`,
    `Today (${s.today.date}): ${s.today.status}, ${String(s.today.meals)} meal(s)`,
  ].join("\n");
}

/** The screen the side panel is showing (07 §5), as a text block of the user turn. */
export function screenContextText(screen: string): string {
  return `The admin is looking at: ${screen}`;
}
