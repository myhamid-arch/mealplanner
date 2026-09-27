import { Chip } from "../../ui/chip";
import type { IconName } from "../../ui/icon";

/** A plate's fit (UX-6: icon and text, not colour alone). */
export const FIT: Readonly<
  Record<
    string,
    { text: string; tone: "basil" | "saffron" | "pomegranate" | "neutral"; icon: IconName }
  >
> = {
  in_tolerance: { text: "on target", tone: "basil", icon: "check" },
  flexible_miss: { text: "close", tone: "saffron", icon: "approx" },
  infeasible: { text: "off target", tone: "pomegranate", icon: "cross" },
  untargeted: { text: "no targets", tone: "neutral", icon: "dash" },
  candidate: { text: "on target", tone: "basil", icon: "check" },
  error: { text: "could not solve", tone: "pomegranate", icon: "cross" },
};

export function FitBadge({ status, who }: { readonly status: string; readonly who?: string }) {
  const fit = FIT[status] ?? {
    text: status.replace(/_/g, " "),
    tone: "neutral" as const,
    icon: "dash" as const,
  };
  return (
    <Chip tone={fit.tone} icon={fit.icon} size="sm">
      {who === undefined ? fit.text : `${who}: ${fit.text}`}
    </Chip>
  );
}
