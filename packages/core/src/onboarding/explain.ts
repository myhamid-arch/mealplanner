// Where each inferred setting is adjusted after saving (SC-7). The routes are 1.4.3's screens.
import type { AdjustTarget } from "./types.js";

export function adjustHref(target: AdjustTarget): string {
  switch (target.screen) {
    case "family":
      return "/family";
    case "member":
      return `/family/${target.memberId}#${target.section}`;
    case "schedule":
      return `/settings/schedule?slot=${encodeURIComponent(target.slotKey)}`;
    case "tastes":
      return `/family/tastes#${target.section}`;
  }
}

/** Avatar colour names (`member.color`) in the order onboarding assigns them (SPEC-Q-2). */
export const MEMBER_COLOR_ORDER = [
  "sea",
  "aubergine",
  "pomegranate",
  "saffron",
  "basil",
  "tomato",
  "olive",
  "flour",
] as const;
