import {
  avatarInk,
  avatarPalette,
  resolveAvatarColor,
  type AvatarColor,
} from "@mealplanner/ui-tokens/tokens";

export interface AvatarProps {
  readonly name: string;
  /** The member's stored colour (`member.color`). When given, it wins. */
  readonly color?: AvatarColor | null;
  /** Stable key (member id) for the fallback colour when none is stored; defaults to the name. */
  readonly colorKey?: string;
  readonly size?: 30 | 36 | 44 | 56;
  /**
   * Set when the avatar stands alone (no visible name next to it); it is then announced with
   * the name. By default it is decorative.
   */
  readonly labelled?: boolean;
  readonly className?: string;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** First character (grapheme) of the name, upper-cased; works for non-Latin names too. */
export function initialOf(name: string): string {
  const first = GRAPHEMES.segment(name.trim())[Symbol.iterator]().next();
  return first.done === true ? "?" : first.value.segment.toLocaleUpperCase();
}

const FONT: Record<NonNullable<AvatarProps["size"]>, number> = { 30: 13, 36: 15, 44: 17, 56: 22 };

/** Coloured-initial avatar (R2-UX-5: no emoji avatars). */
export function Avatar({
  name,
  color,
  colorKey,
  size = 36,
  labelled = false,
  className = "",
}: AvatarProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: FONT[size],
        background: avatarPalette[resolveAvatarColor(color, colorKey ?? name)],
        color: avatarInk,
      }}
      data-avatar-color={resolveAvatarColor(color, colorKey ?? name)}
      {...(labelled ? { role: "img", "aria-label": name } : { "aria-hidden": true })}
    >
      {initialOf(name)}
    </span>
  );
}
