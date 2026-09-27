import type { ReactNode } from "react";

// The platform operator's pages (R2-ADM-8): outside households, so no household shell; the
// console draws its own header (PlatformConsole.dc.html).
export default function PlatformLayout({ children }: { readonly children: ReactNode }) {
  return <div className="min-h-dvh bg-paper text-ink">{children}</div>;
}
