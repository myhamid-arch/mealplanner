import Link from "next/link";
import { Icon } from "../../../components/ui/icon";
import { activeKey, tabsFor } from "./nav";
import type { ShellViewer } from "./viewer";

/**
 * Phone tab bar (TabBar.dc.html, UX-3). Fixed to the bottom, above the home indicator. Pure:
 * the caller passes the current path.
 */
export function TabBar({
  viewer,
  pathname,
}: {
  readonly viewer: ShellViewer | null;
  readonly pathname: string;
}) {
  const items = tabsFor(viewer?.role ?? null);
  const active = activeKey(pathname, items);
  return (
    <nav
      aria-label="Tabs"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card px-2.5 pt-2 pb-[max(18px,env(safe-area-inset-bottom))]"
    >
      <ul
        className="m-0 grid list-none gap-1 p-0"
        style={{ gridTemplateColumns: `repeat(${String(items.length)}, minmax(0, 1fr))` }}
      >
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key} className="min-w-0">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-md text-xs font-extrabold no-underline ${
                  current
                    ? "bg-tomato-tint text-tomato-text hover:text-tomato-text"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                <Icon name={item.icon} size={22} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
