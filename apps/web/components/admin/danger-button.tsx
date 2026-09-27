import type { ReactNode } from "react";

/**
 * The confirming button of a destructive dialog (BlockDialog.dc.html "Block Layla": a solid dark
 * red button). Drawn with the error-text colour as its fill and the card colour as its text, the
 * same pair as error text on a card, so it keeps AA contrast in both themes.
 */
export function DangerButton({
  busy = false,
  onClick,
  children,
  type = "submit",
}: {
  readonly busy?: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-pomegranate-text px-5 py-2.5 text-[15px] font-extrabold text-card disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy && (
        <span
          aria-hidden
          className="size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
        />
      )}
      {children}
    </button>
  );
}
