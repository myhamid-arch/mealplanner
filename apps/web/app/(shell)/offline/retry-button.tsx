"use client";

import { Button } from "../../../components/ui/button";

/** Reloads the page the user was trying to reach (UX-7: errors offer a retry). */
export function RetryButton() {
  return (
    <Button
      icon="refresh"
      onClick={() => {
        window.location.reload();
      }}
    >
      Try again
    </Button>
  );
}
