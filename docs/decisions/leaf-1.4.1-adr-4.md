# leaf-1.4.1 ADR-4: email delivery

Status: accepted at CP1 (R-40); as built at CP2
Requirement: R2-ADM-1 (magic link, password reset), R2-ADM-2 (email invites), ARC-9 (`EMAIL_*` optional; R-6: `EMAIL_FROM`, `EMAIL_SERVER`)

## Decision

- `Mailer` port in `apps/web/lib/server/mail.ts`: `send({ to, subject, text, html })`.
- With `EMAIL_SERVER` (an SMTP URL) and `EMAIL_FROM` set: `nodemailer` **10.0.10** (`createTransport(EMAIL_SERVER)`), dependency requested for `apps/web` with `@types/nodemailer` 8.0.2.
- Without them: magic link, password reset email and email invites return `503 email_not_configured`; code, link and QR invites still work. Nothing is silently dropped.
- Tests inject a capturing mailer through the same port (test-only), and read the magic link / reset token from it.
