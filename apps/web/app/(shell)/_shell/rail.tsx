import Link from "next/link";
import { Avatar } from "../../../components/ui/avatar";
import { Icon } from "../../../components/ui/icon";
import { activeKey, hasAssistant, railFor, ROUTES } from "./nav";
import type { ShellViewer } from "./viewer";

const ITEM =
  "flex min-h-11 items-center gap-3 rounded-md px-3.5 py-2.5 text-[15px] font-bold no-underline";

/** Desktop navigation rail (Rail.dc.html, UX-3). Pure: the caller passes the current path. */
export function Rail({
  viewer,
  pathname,
}: {
  readonly viewer: ShellViewer | null;
  readonly pathname: string;
}) {
  const items = railFor(viewer?.role ?? null);
  const active = activeKey(pathname, items);
  return (
    <nav
      aria-label="Main"
      data-surface="rail"
      className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col gap-[18px] overflow-y-auto bg-rail px-3.5 py-[22px] text-rail-ink"
    >
      <Link
        href={ROUTES.today}
        className="flex min-h-11 items-center gap-2.5 rounded-md px-2 py-1 text-rail-ink-strong no-underline hover:text-rail-ink-strong"
      >
        <span className="flex size-[34px] items-center justify-center rounded-sm bg-rail-active text-on-rail-active">
          <Icon name="kitchen" />
        </span>
        <span className="font-display text-[22px] font-bold">Mise</span>
      </Link>

      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`${ITEM} ${
                  current
                    ? "bg-rail-active text-on-rail-active hover:text-on-rail-active"
                    : "text-rail-ink hover:bg-rail-raised hover:text-rail-ink"
                }`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {viewer !== null && hasAssistant(viewer.role) && (
        <Link
          href={ROUTES.chat}
          aria-current={pathname.startsWith(ROUTES.chat) ? "page" : undefined}
          className="mt-1.5 flex min-h-11 items-center gap-2.5 rounded-lg bg-agent px-3.5 py-3 text-[15px] font-extrabold text-on-agent no-underline hover:bg-agent-raised hover:text-on-agent"
        >
          <Icon name="assistant" />
          <span className="grow">Assistant</span>
          {viewer.pendingProposals > 0 && (
            <>
              <span
                aria-hidden
                className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-badge px-1.5 text-xs text-on-badge"
              >
                {viewer.pendingProposals}
              </span>
              <span className="sr-only">, {viewer.pendingProposals} pending proposals</span>
            </>
          )}
        </Link>
      )}

      <div className="grow" />

      {viewer !== null && (
        <Link
          href={ROUTES.account}
          aria-current={pathname.startsWith(ROUTES.account) ? "page" : undefined}
          className="flex items-center gap-2.5 rounded-md bg-rail-raised p-2.5 text-rail-ink no-underline hover:text-rail-ink"
        >
          <Avatar name={viewer.name} colorKey={viewer.memberKey} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-extrabold text-rail-ink-strong">
              {viewer.name}
            </span>
            <span className="truncate text-xs text-rail-ink-muted">
              {ROLE_LABEL[viewer.role]} · {viewer.householdName}
            </span>
          </span>
        </Link>
      )}
    </nav>
  );
}

const ROLE_LABEL = { admin: "Admin", member: "Member", kitchen: "Kitchen" } as const;
