"use client";

import { cssVarName, fitColor, macroColor, type FitStatus } from "@mealplanner/ui-tokens/tokens";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Icon } from "./icon";

export interface MacroGrams {
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
}

export interface MacroRingProps {
  /** Plate fit: green in tolerance, amber flexible miss, red infeasible, grey untargeted. */
  readonly fit: FitStatus;
  /** Actual grams on the plate; omitted for an untargeted member with no breakdown. */
  readonly macros?: MacroGrams;
  /** Target kcal; the arcs fill to actual ÷ target (capped at a full circle). */
  readonly targetKcal?: number;
  /** Outer diameter in px. */
  readonly size?: number;
  /**
   * What the ring shows, for screen readers (e.g. "Sara, 1656 of 1655 kcal"). The fit status
   * text is appended, so colour is never the only carrier (UX-6).
   */
  readonly label: string;
  /** Centre content: an Avatar or a number. */
  readonly children?: ReactNode;
}

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;
const ORDER = ["protein", "carbs", "fat"] as const;

function color(token: Parameters<typeof cssVarName>[0]): string {
  return `var(--${cssVarName(token)})`;
}

/** Arc lengths (fractions of the circle) for P, C and F, stacked in that order. */
export function ringSegments(
  macros: MacroGrams,
  targetKcal?: number,
): { key: (typeof ORDER)[number]; start: number; length: number }[] {
  const kcal = ORDER.map((key) => Math.max(0, macros[key]) * KCAL_PER_G[key]);
  const total = kcal.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const fill = targetKcal !== undefined && targetKcal > 0 ? Math.min(1, total / targetKcal) : 1;
  let start = 0;
  return ORDER.map((key, i) => {
    const length = ((kcal[i] ?? 0) / total) * fill;
    const segment = { key, start, length };
    start += length;
    return segment;
  });
}

/**
 * Macro ring (UX-4, UX-5): stacked P/C/F arcs (sea, saffron, olive) inside a thin ring in the
 * fit colour, with a fit badge. Arcs animate to their value unless reduced motion is set.
 */
export function MacroRing({ fit, macros, targetKcal, size = 64, label, children }: MacroRingProps) {
  const reduce = useReducedMotion() === true;
  const fitStyle = fitColor[fit];
  const stroke = Math.max(4, Math.round(size * 0.11));
  const outer = 2.5;
  const r = size / 2 - outer - 1.5 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const segments = macros === undefined ? [] : ringSegments(macros, targetKcal);
  const badge = Math.max(16, Math.round(size * 0.3));
  return (
    <span
      role="img"
      aria-label={`${label}, ${fitStyle.label.toLowerCase()}`}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - outer / 2}
          fill="none"
          stroke={color(fitStyle.fill)}
          strokeWidth={outer}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--flour)"
          strokeWidth={stroke}
        />
        {segments.map((segment) => {
          const dash = segment.length * circumference;
          const common = {
            cx: size / 2,
            cy: size / 2,
            r,
            fill: "none",
            stroke: color(macroColor[segment.key].fill),
            strokeWidth: stroke,
            strokeDashoffset: -segment.start * circumference,
            transform: `rotate(-90 ${String(size / 2)} ${String(size / 2)})`,
          };
          const final = `${String(dash)} ${String(circumference - dash)}`;
          return reduce ? (
            <circle key={segment.key} {...common} strokeDasharray={final} />
          ) : (
            <motion.circle
              key={segment.key}
              {...common}
              initial={{ strokeDasharray: `0 ${String(circumference)}` }}
              animate={{ strokeDasharray: final }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          );
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
      <span
        aria-hidden
        className="absolute flex items-center justify-center rounded-full border-2 border-card"
        style={{
          width: badge,
          height: badge,
          right: -2,
          bottom: -2,
          background: color(fitStyle.tint),
          color: color(fitStyle.text),
        }}
      >
        <Icon name={fitStyle.icon} size={Math.round(badge * 0.62)} strokeWidth={3} />
      </span>
    </span>
  );
}
