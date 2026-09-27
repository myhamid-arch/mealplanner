// One line per plate (TodayPhone "Your plate: grilled hammour 150 g · rice 110 g · …"): each
// component with its variant (when the component has several) and cooked grams or units.
import type { Dish, Plate } from "./api";
import { num } from "./logic";

export interface PlateLine {
  componentId: string;
  name: string;
  /** The variant label when the component can be prepared more than one way. */
  variant: string | null;
  cookedG: number;
  /** Units (e.g. "2 eggs") for unit-portioned components. */
  units: string | null;
}

export function plateLines(plate: Plate, dish: Dish): PlateLine[] {
  const out: PlateLine[] = [];
  for (const item of plate.items) {
    if (item.side) continue;
    const component = dish.components.find((c) => c.id === item.componentId);
    if (component === undefined) continue;
    const variant = component.variants.find((v) => v.id === item.variantId);
    const unitWeight = component.portioning === "unit" ? component.stepG : null;
    const count = unitWeight !== null && unitWeight > 0 ? item.cookedG / unitWeight : null;
    out.push({
      componentId: component.id,
      name: component.name,
      variant: component.variants.length > 1 ? (variant?.label ?? null) : null,
      cookedG: item.cookedG,
      units: count === null ? null : `${num(count)} ${component.unitLabel ?? "pieces"}`,
    });
  }
  return out.filter((l) => l.cookedG > 0);
}

export function plateSummary(plate: Plate, dish: Dish): string {
  return plateLines(plate, dish)
    .map((l) => {
      const name =
        l.variant === null
          ? l.name.toLowerCase()
          : `${l.variant.toLowerCase()} ${l.name.toLowerCase()}`;
      return `${name} ${l.units ?? `${String(Math.round(l.cookedG))} g`}`;
    })
    .join(" · ");
}
