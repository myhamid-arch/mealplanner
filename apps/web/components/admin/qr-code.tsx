import { encode } from "uqr";
import { colors } from "@mealplanner/ui-tokens/tokens";

/**
 * A QR code as one inline SVG path (R2-ADM-2 invite "QR code"; R2-ADM-5 authenticator set-up;
 * leaf-1.4.6 ADR-2). Always light-theme ink on white, in both themes: scanners read dark modules
 * on a light ground reliably, and the inverted dark-theme pair would not scan everywhere.
 */
export function QrCode({
  value,
  label,
  size = 150,
}: {
  readonly value: string;
  /** What the code opens, for screen readers ("QR code for the invite link"). */
  readonly label: string;
  readonly size?: number;
}) {
  const qr = encode(value, { ecc: "M", border: 2 });
  let d = "";
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr-version={qr.version}
    >
      <rect width={qr.size} height={qr.size} fill={colors.light.card} />
      <path d={d} fill={colors.light.ink} />
    </svg>
  );
}
