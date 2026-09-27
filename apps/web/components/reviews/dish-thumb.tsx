// The dish tile of QuickRatePhone: a generated gradient composition, deterministic from the dish id
// (UX-5 "generated gradient per dish"; no emoji, R2-UX-5). Decorative.
const BASES = [
  "var(--basil)",
  "var(--saffron)",
  "var(--tomato)",
  "var(--sea)",
  "var(--aubergine)",
  "var(--olive)",
];
const DOTS = ["var(--saffron)", "var(--paper)", "var(--tomato)", "var(--basil)"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function DishThumb({ id, size = 56 }: { readonly id: string; readonly size?: number }) {
  const h = hash(id);
  const base = BASES[h % BASES.length] ?? "var(--basil)";
  const a = DOTS[(h >>> 3) % DOTS.length] ?? "var(--saffron)";
  const b = DOTS[(h >>> 7) % DOTS.length] ?? "var(--paper)";
  const r = Math.round(size / 5);
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-[14px]"
      style={{
        width: size,
        height: size,
        backgroundColor: base,
        backgroundImage: `radial-gradient(circle at 35% 40%, ${a} 0 ${String(r)}px, transparent ${String(r + 1)}px), radial-gradient(circle at 65% 62%, ${b} 0 ${String(r + 2)}px, transparent ${String(r + 3)}px)`,
      }}
    />
  );
}
