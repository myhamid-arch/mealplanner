import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly icon?: IconName;
  /** The next action (UX-7): usually a LinkButton or Button. */
  readonly action?: ReactNode;
  readonly secondaryAction?: ReactNode;
  readonly headingLevel?: 1 | 2 | 3;
}

/** Designed empty state (UX-7) with the gingham motif (UX-5). */
export function EmptyState({
  title,
  description,
  icon = "kitchen",
  action,
  secondaryAction,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${String(headingLevel)}` as "h1" | "h2" | "h3";
  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-10 text-center shadow-card">
      <span
        aria-hidden
        className="gingham flex size-24 items-center justify-center rounded-2xl text-action"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-card">
          <Icon name={icon} size={30} />
        </span>
      </span>
      <Heading className="text-2xl">{title}</Heading>
      <p className="m-0 max-w-[42ch] text-ink-muted">{description}</p>
      {(action !== undefined || secondaryAction !== undefined) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </section>
  );
}
