export interface SkeletonProps {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly rounded?: "md" | "xl" | "full";
  readonly className?: string;
}

const ROUND = { md: "rounded-md", xl: "rounded-xl", full: "rounded-full" } as const;

/** Loading placeholder (UX-7). Decorative; pulses only when motion is allowed. */
export function Skeleton({
  width = "100%",
  height = 16,
  rounded = "md",
  className = "",
}: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`skeleton-pulse block bg-flour ${ROUND[rounded]} ${className}`}
      style={{ width, height }}
    />
  );
}

/** A labelled loading region: announces "Loading …" once and shows skeleton lines. */
export function SkeletonBlock({
  label,
  lines = 3,
}: {
  readonly label: string;
  readonly lines?: number;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2.5">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}
