// Navigation (UX-3 as amended by the approved mockups, BLD-8 R-21 Q-2/Q-3). One table for the
// rail and the tab bar; routes belong to the screen leaves and may not exist yet.
import type { IconName } from "../../../components/ui/icon";

export const ROLES = ["admin", "member", "kitchen"] as const;
export type Role = (typeof ROLES)[number];

export type NavKey =
  | "today"
  | "plan"
  | "recipes"
  | "kitchen"
  | "reviews"
  | "insights"
  | "family"
  | "settings"
  | "access"
  | "tastes"
  | "me";

export interface NavItem {
  readonly key: NavKey;
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
  /** Extra path prefixes that also mark this item active. */
  readonly alsoActiveFor?: readonly string[];
}

export const ROUTES = {
  today: "/today",
  plan: "/plan",
  recipes: "/recipes",
  kitchen: "/kitchen",
  reviews: "/reviews",
  insights: "/insights",
  family: "/family",
  settings: "/settings",
  access: "/access",
  chat: "/chat",
  account: "/account",
  me: "/family/me",
  offline: "/offline",
} as const;

const ITEMS: Readonly<Record<NavKey, NavItem>> = {
  today: { key: "today", label: "Today", href: ROUTES.today, icon: "today" },
  plan: { key: "plan", label: "Plan", href: ROUTES.plan, icon: "plan" },
  recipes: { key: "recipes", label: "Recipes", href: ROUTES.recipes, icon: "recipes" },
  kitchen: { key: "kitchen", label: "Kitchen", href: ROUTES.kitchen, icon: "kitchen" },
  reviews: { key: "reviews", label: "Reviews", href: ROUTES.reviews, icon: "reviews" },
  insights: { key: "insights", label: "Insights", href: ROUTES.insights, icon: "insights" },
  family: { key: "family", label: "Family", href: ROUTES.family, icon: "family" },
  settings: { key: "settings", label: "Settings", href: ROUTES.settings, icon: "settings" },
  access: { key: "access", label: "People & access", href: ROUTES.access, icon: "access" },
  tastes: { key: "tastes", label: "My tastes", href: ROUTES.me, icon: "me" },
  me: {
    key: "me",
    label: "Me",
    href: ROUTES.me,
    icon: "me",
    alsoActiveFor: [ROUTES.account],
  },
};

/** Desktop rail items per role. `null` (no session known) gets the member set. */
const RAIL: Readonly<Record<Role, readonly NavKey[]>> = {
  // Rail.dc.html: nine items.
  admin: [
    "today",
    "plan",
    "recipes",
    "kitchen",
    "reviews",
    "insights",
    "family",
    "settings",
    "access",
  ],
  // UX-3: members see Today, Plan, Recipes, Reviews and My tastes.
  member: ["today", "plan", "recipes", "reviews", "tastes"],
  // ARC-6 / PRD users: kitchen reads cook sheets, plans and recipes; lands on Kitchen.
  kitchen: ["kitchen", "plan", "recipes"],
};

/** Phone tab bar items per role (TabBar.dc.html: Today · Plan · Recipes · Reviews · Me). */
const TABS: Readonly<Record<Role, readonly NavKey[]>> = {
  admin: ["today", "plan", "recipes", "reviews", "me"],
  member: ["today", "plan", "recipes", "reviews", "me"],
  kitchen: ["kitchen", "plan", "recipes", "me"],
};

export function railFor(role: Role | null): readonly NavItem[] {
  return RAIL[role ?? "member"].map((key) => ITEMS[key]);
}

export function tabsFor(role: Role | null): readonly NavItem[] {
  return TABS[role ?? "member"].map((key) => ITEMS[key]);
}

/** UX-3: admins get the assistant (rail button, floating button on phones). */
export function hasAssistant(role: Role | null): boolean {
  return role === "admin";
}

/** UX-3: kitchen users land on Kitchen; everyone else on Today. For 1.4.4's `/` page. */
export function homePathFor(role: Role | null): string {
  return role === "kitchen" ? ROUTES.kitchen : ROUTES.today;
}

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The item a pathname belongs to: the longest matching href or extra prefix wins, so
 * `/family/me` marks "Me"/"My tastes" rather than "Family".
 */
export function activeKey(pathname: string, items: readonly NavItem[]): NavKey | null {
  let best: { key: NavKey; length: number } | null = null;
  for (const item of items) {
    for (const prefix of [item.href, ...(item.alsoActiveFor ?? [])]) {
      if (matches(pathname, prefix) && (best === null || prefix.length > best.length)) {
        best = { key: item.key, length: prefix.length };
      }
    }
  }
  return best?.key ?? null;
}
