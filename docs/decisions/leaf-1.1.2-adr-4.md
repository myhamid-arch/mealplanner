# leaf-1.1.2 ADR-4: auth-library tables in the schema

Status: proposed (CP1)
Requirement: 02 §1 (`user`, `session` managed by the auth library), ARC-1/ARC-6 (Better Auth + Drizzle adapter), R2-ADM-1, R2-ADM-5 (TOTP), R2-ADM-8

## Problem
1.4.1 wires Better Auth, but only 1.1.2 owns migrations. The auth tables must therefore be created here, in the shape the installed library expects.

## Decision
Tables match **better-auth 1.7.6** (`@better-auth/core` `db/get-tables.mjs` and `plugins/two-factor/schema.d.mts`, read from the installed package in this session):
- `user`: spec columns `id`, `email` (citext, unique), `name`, `password_hash?`, `created_at`, plus the library's required `email_verified` (bool), `image?`, `updated_at`, and the two-factor plugin's `two_factor_enabled` (bool, default false).
- `session`: `id`, `user_id →`, `token` (unique), `expires_at`, `ip_address?`, `user_agent?`, `created_at`, `updated_at`.
- `account`: `id`, `user_id →`, `account_id`, `provider_id`, `access_token?`, `refresh_token?`, `id_token?`, `access_token_expires_at?`, `refresh_token_expires_at?`, `scope?`, `password?`, `created_at`, `updated_at`.
- `verification`: `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at`.
- `two_factor` (TOTP secret, r2): `id`, `user_id →`, `secret`, `backup_codes`, `verified`, `failed_verification_count`, `locked_until?`.

Column names are snake_case; 1.4.1 maps them with the adapter's `fields` options and sets `advanced.database.generateId` to the UUIDv7 generator. IDs are `uuid`.

`platform_operator` (r2 §4.8): `user_id` (PK, → user), `created_at`, `created_by_user_id?`. `support_grant`: `id`, `household_id →`, `operator_user_id →`, `granted_by_user_id →`, `created_at`, `expires_at`, `revoked_at?`.

Better Auth stores the password hash in `account.password`; 02's `user.password_hash` is kept because G1 checks every 02 column (SPEC-Q-6).
