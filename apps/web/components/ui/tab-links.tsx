import Link from "next/link";

export interface TabLink {
  readonly label: string;
  readonly href: string;
}

export interface TabLinksProps {
  readonly items: readonly TabLink[];
  /** The href of the current page's tab; that link gets `aria-current="page"`. */
  readonly activeHref: string;
  /** Accessible name of the navigation, e.g. "Settings sections". */
  readonly label: string;
  readonly className?: string;
}

/**
 * A strip of page links styled like `SegmentedControl` (flour pill, the current page inverted).
 * Navigation, not a choice: each item is a link and the current one is marked with
 * `aria-current`. Scrolls horizontally on narrow screens instead of wrapping.
 */
export function TabLinks({ items, activeHref, label, className = "" }: TabLinksProps) {
  return (
    <nav aria-label={label} className={`max-w-full overflow-x-auto ${className}`}>
      <ul className="inline-flex w-max gap-0.5 rounded-full bg-flour p-1">
        {items.map((item) => {
          const current = item.href === activeHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-extrabold whitespace-nowrap transition-colors ${
                  current ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
