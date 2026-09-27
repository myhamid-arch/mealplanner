// Formatting shared by the sign-in, access, account, change-log and platform screens.
import type { HouseholdRole } from "@mealplanner/core/types";

export const ROLE_LABEL: Readonly<Record<HouseholdRole, string>> = {
  admin: "Admin",
  member: "Member",
  kitchen: "Kitchen",
};

export const ROLE_DESCRIPTION: Readonly<Record<HouseholdRole, string>> = {
  admin: "Everything: people, targets, settings, plans, the assistant.",
  member: "Sees plans and their plates, rates meals, sets their own tastes.",
  kitchen: "Cook sheets and recipes only. Can flag missing ingredients.",
};

/** Invite codes are 10 characters (leaf-1.4.1 SPEC-Q-4), shown as `XXX-XXX-XXXX` (SPEC-Q-14). */
export function groupCode(code: string): string {
  const c = normaliseCode(code);
  return c.length <= 6 ? c : `${c.slice(0, 3)}-${c.slice(3, 6)}-${c.slice(6)}`;
}

/** Upper-cases and drops dashes and spaces, so `khl-7q4 m2pa` matches `KHL7Q4M2PA`. */
export function normaliseCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

const DAY_MS = 86_400_000;

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const FULL = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "Now", "5 minutes ago", "1 hour ago", "Yesterday", "12 Sep" (PeopleAccess "last active"). */
export function lastActive(iso: string | null, now = new Date()): string {
  if (iso === null) return "Never";
  const at = new Date(iso);
  const ms = now.getTime() - at.getTime();
  if (ms < 2 * 60_000) return "Now";
  if (ms < 60 * 60_000) return `${String(Math.floor(ms / 60_000))} minutes ago`;
  if (ms < 12 * 60 * 60_000) {
    const h = Math.floor(ms / 3_600_000);
    return h === 1 ? "1 hour ago" : `${String(h)} hours ago`;
  }
  if (sameDay(at, now)) return `Today ${TIME.format(at)}`;
  if (sameDay(at, new Date(now.getTime() - DAY_MS))) return "Yesterday";
  return DAY_MONTH.format(at);
}

/** Change-log time: "Today 09:42", "Yesterday", "20 Sep" (ChangeLog.dc.html). */
export function logTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (sameDay(at, now)) return `Today ${TIME.format(at)}`;
  if (sameDay(at, new Date(now.getTime() - DAY_MS))) return `Yesterday ${TIME.format(at)}`;
  return DAY_MONTH.format(at);
}

export function fullTime(iso: string): string {
  return FULL.format(new Date(iso));
}

/** "Expires in 5 days", "Expires in 3 hours", "Expired". */
export function expiresIn(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (ms <= 0) return "Expired";
  if (ms < DAY_MS) {
    const h = Math.max(1, Math.round(ms / 3_600_000));
    return `Expires in ${String(h)} ${h === 1 ? "hour" : "hours"}`;
  }
  const d = Math.round(ms / DAY_MS);
  return `Expires in ${String(d)} ${d === 1 ? "day" : "days"}`;
}

/** "Chrome · Mac", "Safari · iPhone" from a user agent (AccountPhone "Signed in on"). */
export function deviceLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent === "") return "Unknown device";
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /okhttp|Expo|Dalvik/i.test(ua)
            ? "App"
            : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Unknown system";
  return `${browser} · ${os}`;
}

/** Age in whole years from a birth year (approximate: the birthday itself is not stored). */
export function ageFrom(birthYear: number | null, now = new Date()): number | null {
  return birthYear === null ? null : Math.max(0, now.getFullYear() - birthYear);
}

/**
 * A `next` parameter that is safe to redirect to: a same-origin absolute path, never
 * `//host` or a scheme (open-redirect guard).
 */
export function safeNext(next: string | null | undefined): string | null {
  if (next === null || next === undefined || next === "") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/^\/(api|_next)\//.test(next)) return null;
  return next;
}

export function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** US dollars with cents (platform AI cost). */
export function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export function thousands(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/** The strength line under a new password (CreateHousehold: "Strong · at least 12 characters"). */
export function passwordHint(password: string): { text: string; strong: boolean } {
  if (password.length === 0)
    return { text: "At least 8 characters; 12 or more is strong", strong: false };
  if (password.length < 8)
    return { text: `${String(8 - password.length)} more characters needed`, strong: false };
  if (password.length < 12)
    return { text: "OK · 12 or more characters is stronger", strong: false };
  return { text: "Strong · at least 12 characters", strong: true };
}

/** The R-42 notice (BLD-8 R-42, the ruling's words). */
export const PASSWORD_REMOVED_TEXT =
  "Your password was removed because you signed in by email link; set a new one in Account";
