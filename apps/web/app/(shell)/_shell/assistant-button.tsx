import Link from "next/link";
import { Icon } from "../../../components/ui/icon";
import { ROUTES } from "./nav";

/**
 * Floating assistant button for admins on phones (UX-3, TodayPhone.dc.html): 58 px, above the
 * tab bar, with a dot when proposals are waiting.
 */
export function AssistantButton({ pending }: { readonly pending: number }) {
  const label =
    pending > 0 ? `Open assistant, ${String(pending)} pending proposals` : "Open assistant";
  return (
    <Link
      href={ROUTES.chat}
      aria-label={label}
      className="fixed right-4 bottom-[calc(100px+env(safe-area-inset-bottom))] z-30 flex size-[58px] items-center justify-center rounded-full bg-agent text-on-agent shadow-raised hover:bg-agent-raised hover:text-on-agent"
    >
      <Icon name="assistant" size={26} />
      {pending > 0 && (
        <span
          aria-hidden
          className="absolute top-1 right-1 size-3.5 rounded-full border-2 border-agent bg-badge"
        />
      )}
    </Link>
  );
}
