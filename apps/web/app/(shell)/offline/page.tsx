import type { Metadata } from "next";
import { LinkButton } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { ROUTES } from "../_shell/nav";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Offline" };

/**
 * Shown by the service worker when a page cannot be loaded offline (ARC-8 phase A, UX-7).
 * Today's plan and the cook sheet stay readable from the offline copy.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 lg:pt-10">
      <EmptyState
        headingLevel={1}
        icon="refresh"
        title="You're offline"
        description="This page needs a connection. The last Today plan and cook sheet you opened are saved on this device, so you can still read them."
        action={<RetryButton />}
        secondaryAction={
          <LinkButton href={ROUTES.today} variant="secondary" icon="today">
            Open saved Today plan
          </LinkButton>
        }
      />
    </div>
  );
}
