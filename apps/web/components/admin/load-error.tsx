"use client";

import { Button } from "../ui/button";
import { FormError } from "./field";

/** A load that failed (UX-7): the reason in plain language and a retry. */
export function LoadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <FormError>{message}</FormError>
      <Button variant="secondary" icon="refresh" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
