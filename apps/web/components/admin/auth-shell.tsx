// Frames of the signed-out screens: the split sign-in (SignIn.dc.html: a gingham brand panel and
// the form) and the centred card (CreateHousehold.dc.html, InviteAccept.dc.html). On phones the
// brand panel shrinks to the logo row.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "../ui/icon";

/** "Mise" with the chef-hat mark (R2-UX-6: working name). */
export function BrandMark({ inverted = false }: { readonly inverted?: boolean }) {
  return (
    <Link
      href="/sign-in"
      className={`inline-flex min-h-11 items-center gap-3 no-underline ${
        inverted ? "text-on-action hover:text-on-action" : "text-ink hover:text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`flex size-10 items-center justify-center rounded-[12px] ${
          inverted ? "bg-paper text-action" : "bg-action text-on-action"
        }`}
      >
        <Icon name="kitchen" size={24} />
      </span>
      <span className="font-display text-[26px] font-bold">Mise</span>
    </Link>
  );
}

// SignIn.dc.html's tablecloth: paper stripes at 14 % over the action colour (UX-5 gingham).
const STRIPE = "color-mix(in srgb, var(--paper) 14%, transparent)";
const GINGHAM = {
  backgroundImage: `repeating-linear-gradient(0deg, ${STRIPE} 0 28px, transparent 28px 56px), repeating-linear-gradient(90deg, ${STRIPE} 0 28px, transparent 28px 56px)`,
} as const;

/** SignIn.dc.html: the brand panel on the left (≥ 1024 px), the form centred on the right. */
export function AuthSplit({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-paper text-ink">
      <aside
        aria-label="About Mise"
        className="hidden w-[min(560px,44vw)] shrink-0 flex-col justify-between bg-action p-14 text-on-action lg:flex"
        style={GINGHAM}
      >
        <BrandMark inverted />
        <div className="flex flex-col gap-3.5 rounded-[22px] bg-paper p-7 text-ink shadow-sheet">
          <p className="m-0 font-display text-[30px] leading-tight font-bold">
            Everyone&rsquo;s macros. One kitchen. Food the whole family likes.
          </p>
          <p className="m-0 text-base text-ink-soft">
            Plans every meal for every person, writes the recipes for your kitchen, and learns from
            what the family thinks.
          </p>
        </div>
      </aside>
      <main
        id="main"
        className="flex grow flex-col items-center px-4 py-7 lg:justify-center lg:px-10"
      >
        <div className="mb-6 self-start lg:hidden">
          <BrandMark />
        </div>
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}

/** CreateHousehold / InviteAccept: the logo, then one card. */
export function AuthCentered({
  children,
  width = 760,
}: {
  readonly children: ReactNode;
  readonly width?: number;
}) {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center gap-7 bg-paper px-4 py-7 text-ink lg:py-12"
    >
      <div className="self-start lg:self-center">
        <BrandMark />
      </div>
      <div
        className="flex w-full flex-col gap-[22px] rounded-2xl bg-card p-5 shadow-card lg:p-10"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </main>
  );
}
