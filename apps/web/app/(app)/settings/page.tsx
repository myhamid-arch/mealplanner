import type { Metadata } from "next";
import Link from "next/link";
import { AdminOnly } from "../../../components/config/admin-gate";
import { TabLinks } from "../../../components/ui/tab-links";
import { Icon, type IconName } from "../../../components/ui/icon";
import { SETTINGS_TABS } from "../../(shell)/_shell/nav";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const CARDS: readonly { href: string; title: string; text: string; icon: IconName }[] = [
  {
    href: "/settings/planning",
    title: "Planning balance",
    text: "How the planner weighs macros, appeal and fewer ingredients; presets for some days.",
    icon: "plan",
  },
  {
    href: "/settings/schedule",
    title: "Meals & schedule",
    text: "Which meals the household has, shared or individual, packed lunches and who eats what.",
    icon: "today",
  },
  {
    href: "/settings/household",
    title: "General",
    text: "Household name, area, time zone, what members see, the assistant and your data.",
    icon: "settings",
  },
  {
    href: "/settings/detail-levels",
    title: "How detail levels work",
    text: "One Basic · Detailed · Expert switch in every section, for each person.",
    icon: "insights",
  },
];

/** Settings (UX-4; R-45): the tab strip shared with 1.4.6 and a card per area. */
export default function SettingsPage() {
  return (
    <AdminOnly what="Household settings">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <h1 className="text-[34px]">Settings</h1>
          <TabLinks items={SETTINGS_TABS} activeHref="/settings" label="Settings sections" />
        </div>
        <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
          {CARDS.map((card) => (
            <li key={card.href}>
              <Link
                href={card.href}
                className="flex h-full items-start gap-3 rounded-2xl bg-card p-5 text-ink no-underline shadow-card hover:text-ink"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-flour text-ink">
                  <Icon name={card.icon} size={22} />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-display text-xl font-bold">{card.title}</span>
                  <span className="text-sm text-ink-soft">{card.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AdminOnly>
  );
}
