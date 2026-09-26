import type { SVGProps } from "react";

/**
 * Stroke icons (UX-5, R2-UX-5): 24 × 24, stroke 2, round caps and joins. The paths are the
 * ones the approved mockups inline (leaf-1.4.2 ADR-2), except `approx`, which the mockups do
 * not draw and is needed for the flexible-miss fit status.
 */
export const ICON_PATHS = {
  today:
    "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0",
  plan: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  recipes: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7",
  kitchen:
    "M7 17h10v3H7zM7 17c-2.5-.5-4-2.6-3.5-5A4 4 0 0 1 8 9a4.5 4.5 0 0 1 8 0a4 4 0 0 1 4.5 3c.5 2.4-1 4.5-3.5 5",
  reviews: "M12 3l2.7 5.6l6.1.9l-4.4 4.3l1 6.1L12 17l-5.4 2.9l1-6.1L3.2 9.5l6.1-.9z",
  insights:
    "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.7 1.5 2.8V17h4v-.3c0-1.1.6-2.1 1.5-2.8A6 6 0 0 0 12 3z",
  family:
    "M9 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.7",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
  access: "M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6zM9 12l2 2l4-4",
  assistant: "M4 5h16v11H9l-5 4zM12 8l1 2l2 1l-2 1l-1 2l-1-2l-2-1l2-1z",
  me: "M12 11a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21v-1a8 8 0 0 1 16 0v1",
  chevronLeft: "M15 6l-6 6l6 6",
  chevronRight: "M9 6l6 6l-6 6",
  arrowRight: "M5 12h14M13 6l6 6l-6 6",
  check: "M5 12l5 5L20 7",
  close: "M6 6l12 12M18 6L6 18",
  cross: "M6 6l12 12M18 6L6 18",
  dash: "M5 12h14",
  approx: "M5 10c2.3-2 4.7-2 7 0s4.7 2 7 0M5 15c2.3-2 4.7-2 7 0s4.7 2 7 0",
  plus: "M12 5v14M5 12h14",
  refresh: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  search: "M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM21 21l-5-5",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  heart:
    "M12 21s-7-4.4-9.3-8.6C1 9.2 2.8 5.5 6.4 5.5c2 0 3.3 1.1 4 2.2c.7-1.1 2-2.2 4-2.2c3.6 0 5.4 3.7 3.7 6.9C19 16.6 12 21 12 21z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  readonly name: IconName;
  readonly size?: number;
  /** When set, the icon is announced with this label; otherwise it is hidden from assistive tech. */
  readonly label?: string;
  readonly strokeWidth?: number;
}

export function Icon({ name, size = 20, label, strokeWidth = 2, ...rest }: IconProps) {
  const a11y =
    label === undefined
      ? { "aria-hidden": true as const, focusable: "false" as const }
      : { role: "img", "aria-label": label };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
