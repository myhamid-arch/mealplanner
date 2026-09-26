# leaf-1.4.6 ADR-2: QR codes for invites and two-step sign-in set-up

Status: proposed at CP1 (dependency request R-d)
Requirement: R2-ADM-2 (invite "sent as email, copy link or QR code"), R2-ADM-5 (TOTP set-up), leaf-1.4.1 SPEC-Q-4 ("the QR image is drawn by the UI (1.4.6)")

## Decision

- Request `uqr` **0.1.3** (MIT, ESM, no dependencies) for `apps/web`. `encode(text, { ecc: "M" })` returns the module matrix; `components/admin/qr-code.tsx` draws it as one inline SVG `<path>` with a quiet zone, `role="img"` and an `aria-label` naming what it encodes, in `--ink` on `--card` (the mockup's colours, AA-contrasting in both themes).
- Used for the invite link (InviteDialog) and the `otpauth://` URI when turning on two-step sign-in (Account).
- Why not hand-written: a QR encoder (Reed–Solomon, masking, version selection) is ~400 lines whose correctness this leaf could not verify without also adding a decoder.
- If the request is declined: the dialog shows the link and code only (no QR), listed as a deviation; no hand-written encoder.
