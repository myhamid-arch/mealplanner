import type { ReactNode } from "react";

export type ActorKind = "user" | "assistant" | "proposal" | "learned" | "support";

const STYLE: Readonly<Record<ActorKind, string>> = {
  user: "bg-sea-tint text-sea-text",
  assistant: "bg-aubergine-tint text-aubergine-text",
  proposal: "bg-saffron-tint text-saffron-text",
  learned: "bg-basil-tint text-basil-text",
  support: "bg-flour text-ink-muted",
};

/** Who or what made a change (R2-ADM-7 actor badges); the text always says it too (UX-6). */
export function ActorBadge({
  kind,
  children,
}: {
  readonly kind: ActorKind;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-[13px] font-extrabold ${STYLE[kind]}`}
    >
      {children}
    </span>
  );
}
