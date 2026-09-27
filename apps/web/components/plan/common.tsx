"use client";
// Shared parts of the Today, Plan, Plate and Kitchen screens: the household basics every screen
// reads, the fit badge (UX-6: text + icon), loading and error states (UX-7), and the few stroke
// icons the design-system set does not carry (R2-UX-5: inline Lucide-style SVG).
import type { ReactNode } from "react";
import { Button, Chip, EmptyState, Icon, SkeletonBlock } from "../ui";
import { api, c, type Household, type Me, type Member, type Role, type Slot } from "./api";
import { fitLook, localDate, type FitStatus } from "./logic";

export interface Basics {
  me: Me;
  role: Role;
  /** The member the login eats as (null for a login without one, e.g. most kitchen users). */
  memberId: string | null;
  household: Household;
  members: Member[];
  slots: Slot[];
  /** Today in the household's time zone. */
  today: string;
  /** Cuisine labels by key. */
  cuisines: Map<string, string>;
}

/** The viewer and household facts every screen of this leaf needs, in one round of calls. */
export async function loadBasics(): Promise<Basics> {
  const [me, household, members, slots, cuisines] = await Promise.all([
    api.call(c.me, {}),
    api.call(c.householdGet, {}),
    api.call(c.membersList, {}),
    api.call(c.slotsList, {}),
    api.call(c.cuisinesList, {}),
  ]);
  const membership =
    me.memberships.find((m) => m.householdId === household.id) ?? me.memberships[0];
  return {
    me,
    role: membership?.role ?? "member",
    memberId: membership?.memberId ?? null,
    household,
    // Adults first, then by age (TodayDesktop, CookSheet order); unknown ages last.
    members: (members.members ?? [])
      .filter((m) => m.archivedAt === null)
      .sort(
        (a, b) =>
          Number(b.isTargeted) - Number(a.isTargeted) ||
          (a.birthYear ?? 9999) - (b.birthYear ?? 9999) ||
          a.displayName.localeCompare(b.displayName),
      ),
    slots: [...(slots.slots ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    today: localDate(new Date(), household.timezone),
    cuisines: new Map((cuisines.cuisines ?? []).map((x) => [x.key, x.label])),
  };
}

export function cuisineLabel(basics: Basics, key: string | undefined): string {
  return key === undefined ? "" : (basics.cuisines.get(key) ?? key.replaceAll("_", " "));
}

/** UX-6: fit as a chip with an icon and text, never colour alone. */
export function FitBadge({
  status,
  size = "sm",
  label,
}: {
  readonly status: FitStatus;
  readonly size?: "sm" | "md";
  readonly label?: string;
}) {
  const look = fitLook(status);
  return (
    <Chip tone={look.tone} icon={look.icon} size={size}>
      {label ?? look.label}
    </Chip>
  );
}

/** Plain fit text with its icon (TodayDesktop person × slot grid). */
export function FitText({ status }: { readonly status: FitStatus }) {
  const look = fitLook(status);
  const color =
    look.tone === "basil"
      ? "text-basil-text"
      : look.tone === "saffron"
        ? "text-saffron-text"
        : look.tone === "pomegranate"
          ? "text-pomegranate-text"
          : "text-ink-muted";
  return (
    <span className={`inline-flex items-center gap-1 font-extrabold ${color}`}>
      <Icon name={look.icon} size={16} strokeWidth={2.5} />
      {look.label}
    </span>
  );
}

export function Loading({ label }: { readonly label: string }) {
  return (
    <div data-loading>
      <SkeletonBlock label={label} lines={5} />
    </div>
  );
}

/** UX-7: a plain-language error with a retry. */
export function LoadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <EmptyState
      headingLevel={2}
      icon="refresh"
      title="That did not load"
      description={message}
      action={
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

/** Icons the shared set lacks, drawn the same way (24 × 24, stroke 2, round caps). */
const EXTRA = {
  printer:
    "M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z",
  flag: "M4 22V4M4 4h13l-2 4l2 4H4",
  scale: "M4 20h16M6 20V9h12v11M9 9V5h6v4",
  swap: "M7 4L3 8l4 4M3 8h14M17 20l4-4l-4-4M21 16H7",
  unlock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2",
  text: "M4 7V5h16v2M9 19h6M12 5v14",
  people:
    "M16 21v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM19 8v6M22 11h-6",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
} as const;

export type ExtraIcon = keyof typeof EXTRA;

export function ExtraIconSvg({
  name,
  size = 20,
  label,
  strokeWidth = 2,
  className,
}: {
  readonly name: ExtraIcon;
  readonly size?: number;
  readonly label?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
}) {
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
      className={className}
      {...(label === undefined
        ? { "aria-hidden": true, focusable: "false" }
        : { role: "img", "aria-label": label })}
    >
      <path d={EXTRA[name]} />
    </svg>
  );
}

/** A page heading row: optional eyebrow, the Fraunces title, and controls on the right. */
export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 grow flex-col">
        {eyebrow !== undefined && (
          <span className="text-[13px] font-extrabold text-ink-muted">{eyebrow}</span>
        )}
        <h1 className="m-0 font-display text-[28px] leading-tight font-bold lg:text-[32px]">
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
