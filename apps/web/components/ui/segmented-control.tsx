"use client";

import { RadioGroup } from "radix-ui";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  /** Accessible name of the group, e.g. "Detail level for targets". */
  readonly label: string;
  readonly className?: string;
}

/**
 * Segmented single choice (DetailLevels.dc.html): a radio group on a flour pill, the chosen
 * option inverted (ink on paper). Arrow keys move and select (Radix RadioGroup). Used for the
 * R2-DL Basic · Detailed · Expert control and other 2–4 option switches.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option !== undefined) onValueChange(option.value);
      }}
      orientation="horizontal"
      className={`inline-flex w-fit gap-0.5 rounded-full bg-flour p-1 ${className}`}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className="min-h-11 rounded-full px-4 text-sm font-extrabold text-ink-soft transition-colors hover:text-ink data-[state=checked]:bg-ink data-[state=checked]:text-paper"
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
