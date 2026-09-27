"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { destinationAfterSignIn } from "../../../components/admin/destination";
import { Button } from "../../../components/ui/button";
import { SkeletonBlock } from "../../../components/ui/skeleton";

/** Sends the person on to their home (SPEC-Q-13): at once, or when they choose to. */
export function Forward({ next, auto }: { readonly next: string | null; readonly auto: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(auto);

  async function go() {
    setBusy(true);
    router.replace(await destinationAfterSignIn(next));
    router.refresh();
  }

  useEffect(() => {
    if (auto) void go();
  }, []);

  if (auto) return <SkeletonBlock label="Signing you in" lines={3} />;
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={() => {
        void go();
      }}
    >
      Not now, continue
    </Button>
  );
}
