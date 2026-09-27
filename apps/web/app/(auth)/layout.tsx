import type { ReactNode } from "react";

// The signed-out screens (sign-in, create household, invite, reset, the magic-link landing):
// no app shell, each screen draws its own frame (components/admin/auth-shell.tsx).
export default function AuthLayout({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}
