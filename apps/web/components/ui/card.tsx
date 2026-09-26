import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Recipe-card paper lines (UX-5), for recipe pages. */
  readonly ruled?: boolean;
  /** Rise on load (UX-5 motion; off under prefers-reduced-motion). */
  readonly rise?: boolean;
  /** Emphasised card (the mockups' "up next" card): a 2.5 px action border. */
  readonly highlight?: boolean;
  readonly as?: "div" | "section" | "article";
}

/** Recipe-card surface (UX-5): card colour, 18 px radius, a soft line shadow. */
export function Card({
  ruled = false,
  rise = false,
  highlight = false,
  as: Tag = "div",
  className = "",
  ...rest
}: CardProps) {
  return (
    <Tag
      className={`rounded-xl bg-card p-4 text-ink ${
        highlight ? "border-[2.5px] border-action" : "shadow-card"
      } ${ruled ? "ruled" : ""} ${rise ? "rise" : ""} ${className}`}
      {...rest}
    />
  );
}
