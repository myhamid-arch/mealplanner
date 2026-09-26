"use client";

import { usePathname } from "next/navigation";
import { AppShellFrame, type AppShellProps } from "./app-shell";

/** The shell with the current path taken from the router. */
export function AppShell(props: Omit<AppShellProps, "pathname">) {
  const pathname = usePathname();
  return <AppShellFrame {...props} pathname={pathname} />;
}
