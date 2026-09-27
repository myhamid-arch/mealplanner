"use client";
// Kitchen flags on the cook sheet (R2-UX-1; CookSheet.dc.html "Something missing or unclear?"):
// "Flag an ingredient" (unavailable: the planner substitutes it through the knowledge graph and
// re-solves the affected plates) and "Recipe unclear" (a note on the variant for the assistant).
// POST /cook-sheets/{date}/flags; the kitchen then sees its own flags and what happened.
import { useId, useState } from "react";
import { Button, Dialog } from "../ui";
import { api, c, problemText, type CookSheetMeal, type KitchenFlagView } from "./api";
import { ExtraIconSvg } from "./common";
import { lowerFirst } from "./flag-results";

export interface FlagChoice {
  id: string;
  label: string;
}

/** The ingredients of a meal's batches (unique, by name) for "Flag an ingredient". */
export function ingredientChoices(
  meal: CookSheetMeal,
  nameOf: (id: string, slug: string) => string,
): FlagChoice[] {
  const seen = new Map<string, string>();
  for (const b of meal.batches)
    for (const r of [...b.raw, ...b.discardedFat])
      if (!seen.has(r.ingredientId)) seen.set(r.ingredientId, nameOf(r.ingredientId, r.slug));
  return [...seen]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The meal's variants (one per batch) for "Recipe unclear". */
export function variantChoices(meal: CookSheetMeal): FlagChoice[] {
  const seen = new Map<string, string>();
  for (const b of meal.batches)
    if (!seen.has(b.variantId))
      seen.set(b.variantId, `${b.componentName} (${b.variantLabel.toLowerCase()})`);
  return [...seen].map(([id, label]) => ({ id, label }));
}

export function FlagDialog({
  kind,
  date,
  meal,
  choices,
  open,
  onOpenChange,
  onSent,
}: {
  readonly kind: "unavailable" | "unclear";
  readonly date: string;
  readonly meal: CookSheetMeal;
  readonly choices: readonly FlagChoice[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSent: (text: string) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState(choices[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = choices.find((x) => x.id === choice);
  const send = async () => {
    if (picked === undefined) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await api.call(c.cookSheetsFlag, {
        params: { date },
        body:
          kind === "unavailable"
            ? {
                kind: "unavailable",
                ingredientId: picked.id,
                planMealId: meal.planMealId,
                ...(trimmed === "" ? {} : { note: trimmed }),
              }
            : {
                kind: "unclear",
                variantId: picked.id,
                planMealId: meal.planMealId,
                ...(trimmed === "" ? {} : { note: trimmed }),
              },
      });
      setNote("");
      onOpenChange(false);
      onSent(
        kind === "unavailable"
          ? `Sent: no ${picked.label.toLowerCase()} today. The planner is finding a substitute and re-checking the plates.`
          : `Sent: ${picked.label} is unclear. The admins and the assistant will look at it.`,
      );
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={kind === "unavailable" ? "Flag an ingredient" : "Recipe unclear"}
      description={
        kind === "unavailable"
          ? `Which ingredient for ${meal.dishName} is missing today?`
          : `Which part of ${meal.dishName} is unclear?`
      }
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button loading={busy} disabled={picked === undefined} onClick={() => void send()}>
            Send flag
          </Button>
        </>
      }
    >
      <label htmlFor={`${id}-what`} className="font-extrabold">
        {kind === "unavailable" ? "Ingredient" : "Recipe part"}
      </label>
      <select
        id={`${id}-what`}
        value={choice}
        onChange={(e) => {
          setChoice(e.target.value);
        }}
        className="min-h-11 rounded-md border-[1.5px] border-line-strong bg-card px-3 text-ink"
      >
        {choices.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-note`} className="font-extrabold">
        Note <span className="font-normal text-ink-muted">(optional)</span>
      </label>
      <textarea
        id={`${id}-note`}
        value={note}
        maxLength={500}
        rows={3}
        onChange={(e) => {
          setNote(e.target.value);
        }}
        placeholder={kind === "unavailable" ? "None at the market today" : "Which pan? How long?"}
        className="rounded-md border-[1.5px] border-line-strong bg-card p-3 text-ink placeholder:text-ink-muted"
      />
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** The kitchen's own flags of the day and what happened (GET /cook-sheets/{date}/flags). */
export function OwnFlags({ flags }: { readonly flags: readonly KitchenFlagView[] }) {
  if (flags.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm" aria-label="Your flags today">
      {flags.map((f) => {
        const running =
          f.kind === "unavailable" &&
          (f.job === null || f.job.status === "queued" || f.job.status === "running");
        const outcome =
          f.kind === "unclear"
            ? "The admins will look at it."
            : running
              ? "Finding a substitute…"
              : f.result === null || f.result.meals.length === 0
                ? "Nothing planned needed changing."
                : `Use ${f.result.substituteName ?? "the substitute"}: ${f.result.meals
                    .map((m) => m.toDishName)
                    .join(", ")}. Plates re-checked.`;
        return (
          <li key={f.reviewId} className="flex items-start gap-2">
            <ExtraIconSvg name="flag" size={16} className="mt-0.5 shrink-0 text-pomegranate-text" />
            <span>
              <strong>
                {f.kind === "unavailable"
                  ? `No ${lowerFirst(f.ingredientName ?? "ingredient")}`
                  : "Recipe unclear"}
              </strong>{" "}
              {outcome}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
