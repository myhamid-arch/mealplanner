import type { Tone } from "@mealplanner/ui-tokens/tokens";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// Tint background + text colour per tone; each pair is declared in TEXT_PAIRS (toneColor).
const TONE: Record<Tone, string> = {
  neutral: "bg-flour text-ink-muted",
  tomato: "bg-tomato-tint text-tomato-text",
  basil: "bg-basil-tint text-basil-text",
  sea: "bg-sea-tint text-sea-text",
  saffron: "bg-saffron-tint text-saffron-text",
  olive: "bg-olive-tint text-olive-text",
  pomegranate: "bg-pomegranate-tint text-pomegranate-text",
  aubergine: "bg-aubergine-tint text-aubergine-text",
};

export interface ChipProps {
  readonly tone?: Tone;
  /** A leading icon, so colour is never the only signal (UX-6). */
  readonly icon?: IconName;
  readonly size?: "sm" | "md";
  readonly className?: string;
  readonly children: ReactNode;
}

/** Tag / status chip. For a toggleable chip, wrap it in a button with aria-pressed. */
export function Chip({ tone = "neutral", icon, size = "md", className = "", children }: ChipProps) {
  const sizing = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-extrabold ${sizing} ${TONE[tone]} ${className}`}
    >
      {icon !== undefined && <Icon name={icon} size={size === "sm" ? 14 : 16} strokeWidth={2.5} />}
      {children}
    </span>
  );
}
