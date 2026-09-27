import type { IterationLimitCard as Card } from "./parse";

const words = (s: string) => s.replace(/_/g, " ");

/** The loop stopped at its cap (AGT-2): what ran and what was left. */
export function IterationLimitCardView({ card }: { readonly card: Card }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-xl bg-saffron-tint p-4 text-saffron-text"
      data-card="iteration_limit"
    >
      <span className="font-extrabold">Stopped after {card.limit} steps</span>
      {card.ran.length > 0 && (
        <span className="text-sm">
          Done: {card.ran.map((r) => `${words(r.name)}${r.ok ? "" : " (failed)"}`).join(", ")}
        </span>
      )}
      {card.notRun.length > 0 && (
        <span className="text-sm">
          Not done yet: {card.notRun.map((r) => words(r.name)).join(", ")}
        </span>
      )}
      <span className="text-sm">Ask again to carry on from here.</span>
    </div>
  );
}
