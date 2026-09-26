import { cssVarName, macroColor, type Macro } from "@mealplanner/ui-tokens/tokens";
import { useId } from "react";

export interface MacroBarProps {
  readonly macro: Macro;
  readonly actual: number;
  readonly target: number;
  /** ± tolerance around the target (PLN tolerances: P ±5, C ±5, F ±2, kcal ±50). */
  readonly tolerance: number;
  /** Overrides the default name ("Protein", "Carbs", "Fat", "Calories"). */
  readonly label?: string;
}

const NAME: Record<Macro, string> = {
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  kcal: "Calories",
};

/** Tolerance widths shown across the bar: the band (2 × tolerance) takes 2/7 of the track. */
const HALF_SPAN_IN_TOLERANCES = 3.5;

function unit(macro: Macro): string {
  return macro === "kcal" ? "" : " g";
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Position of a value on the track, 0–100 %, clamped. */
export function barPosition(value: number, target: number, tolerance: number): number {
  const half = Math.max(tolerance, Number.EPSILON) * HALF_SPAN_IN_TOLERANCES;
  const pct = ((value - (target - half)) / (2 * half)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Plain-language position against the target, e.g. "3 g above the target range". */
export function describeFit(
  macro: Macro,
  actual: number,
  target: number,
  tolerance: number,
): string {
  const low = target - tolerance;
  const high = target + tolerance;
  if (actual >= low && actual <= high) return "within target";
  const by = actual < low ? low - actual : actual - high;
  return `${format(by)}${unit(macro)} ${actual < low ? "below" : "above"} the target range`;
}

/**
 * Macro bar (UX-4 plate detail, PlatePhone.dc.html): the target band shaded, the actual value
 * as a marker. Exposed as a meter with a spoken value (UX-6).
 */
export function MacroBar({ macro, actual, target, tolerance, label }: MacroBarProps) {
  const id = useId();
  const tokens = macroColor[macro];
  const name = label ?? NAME[macro];
  const bandLeft = barPosition(target - tolerance, target, tolerance);
  const bandRight = barPosition(target + tolerance, target, tolerance);
  const marker = barPosition(actual, target, tolerance);
  const valueText = `${format(actual)}${unit(macro)}, target ${format(target)}${unit(macro)} plus or minus ${format(tolerance)}, ${describeFit(macro, actual, target, tolerance)}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex justify-between gap-3 text-[13px] font-extrabold">
        <span id={id} style={{ color: `var(--${cssVarName(tokens.text)})` }}>
          {name}
        </span>
        <span className="tabular text-ink">
          {format(actual)}
          {unit(macro)} · target {format(target)} ±{format(tolerance)}
        </span>
      </span>
      <div
        role="meter"
        aria-labelledby={id}
        aria-valuemin={target - tolerance * HALF_SPAN_IN_TOLERANCES}
        aria-valuemax={target + tolerance * HALF_SPAN_IN_TOLERANCES}
        aria-valuenow={actual}
        aria-valuetext={valueText}
        className="relative h-3 rounded-[6px] bg-flour"
      >
        <div
          className="absolute h-3 rounded-[6px]"
          style={{
            left: `${String(bandLeft)}%`,
            width: `${String(bandRight - bandLeft)}%`,
            background: `color-mix(in srgb, var(--${cssVarName(tokens.fill)}) 35%, var(--card))`,
          }}
        />
        <div
          className="absolute -top-[3px] h-[18px] w-1 -translate-x-1/2 rounded-[2px]"
          style={{ left: `${String(marker)}%`, background: `var(--${cssVarName(tokens.text)})` }}
        />
      </div>
    </div>
  );
}
