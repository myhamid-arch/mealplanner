"use client";

// Better Auth 1.7.6 HTTP endpoints used by the sign-in, reset and account screens (R2-ADM-1,
// R2-ADM-5, BLD-8 R-42; leaf-1.4.6 ADR-1). Each path and body was checked in the installed
// package. Sign-up, password change and two-step set-up are /api/v1 endpoints (the typed client).
import { clearOfflineCache } from "../../app/(shell)/_shell/offline-cache";

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_TOKEN: "This link has expired or was already used. Ask for a new one.",
  INVALID_CODE: "That code is not right. Check your authenticator app and try again.",
  INVALID_TWO_FACTOR_COOKIE: "The sign-in took too long. Start again with your password.",
  PASSWORD_TOO_SHORT: "The password needs at least 8 characters.",
  PASSWORD_TOO_LONG: "The password can have at most 128 characters.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a minute and try again.",
};

function sentence(text: string): string {
  const t = text.trim();
  if (t === "") return "Something went wrong.";
  const s = `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: init.method,
    credentials: "include",
    headers: init.body === undefined ? {} : { "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text === "" ? null : JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { code?: unknown; message?: unknown; detail?: unknown };
    const code = typeof d.code === "string" ? d.code : `HTTP_${String(res.status)}`;
    const raw =
      typeof d.message === "string" ? d.message : typeof d.detail === "string" ? d.detail : "";
    const message =
      MESSAGES[code] ??
      (res.status === 429
        ? MESSAGES.TOO_MANY_ATTEMPTS
        : res.status === 503
          ? "Email is not set up on this server, so no link can be sent."
          : sentence(raw));
    throw new AuthError(res.status, code, message ?? "Something went wrong.");
  }
  return data as T;
}

export type SignInResult = { kind: "signed-in" } | { kind: "two-step" };

/** Email and password (R2-ADM-1). With two-step sign-in on, the TOTP step follows. */
export async function signInWithPassword(input: {
  email: string;
  password: string;
  rememberMe: boolean;
}): Promise<SignInResult> {
  const data = await call<{ twoFactorRedirect?: boolean } | null>("/sign-in/email", {
    method: "POST",
    body: { email: input.email.trim(), password: input.password, rememberMe: input.rememberMe },
  });
  return data?.twoFactorRedirect === true ? { kind: "two-step" } : { kind: "signed-in" };
}

/** The second step of a two-step sign-in (R2-ADM-5). */
export async function verifyTwoStepCode(input: {
  code: string;
  trustDevice: boolean;
}): Promise<void> {
  await call("/two-factor/verify-totp", {
    method: "POST",
    body: { code: input.code.replace(/\s/g, ""), trustDevice: input.trustDevice },
  });
}

/**
 * Emails a one-time sign-in link (R2-ADM-1). The link lands on `/signed-in`, which shows the
 * R-42 notice when the library removed the password (leaf-1.4.6 SPEC-Q-4).
 */
export async function requestSignInLink(email: string, next: string | null): Promise<void> {
  const callbackURL = next === null ? "/signed-in" : `/signed-in?next=${encodeURIComponent(next)}`;
  await call("/sign-in/magic-link", {
    method: "POST",
    body: { email: email.trim(), callbackURL },
  });
}

/** Emails a password-reset link that lands on `/reset-password` (R2-ADM-1, SPEC-Q-5). */
export async function requestPasswordReset(email: string): Promise<void> {
  await call("/request-password-reset", {
    method: "POST",
    body: { email: email.trim(), redirectTo: "/reset-password" },
  });
}

/** Sets the new password; creates it when the account has none (R-42). Signs out everywhere. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await call("/reset-password", { method: "POST", body: { token, newPassword } });
}

/** Whether the signed-in account has a password (a `credential` account; SPEC-Q-5). */
export async function hasPassword(): Promise<boolean> {
  const accounts = await call<{ providerId?: string }[] | null>("/list-accounts", {
    method: "GET",
  });
  return (accounts ?? []).some((a) => a.providerId === "credential");
}

/**
 * Signs out. The pages kept for offline reading go first (BLD-8 R-21 Q-8), so a shared device
 * keeps no household plan even if the request fails.
 */
export async function signOut(): Promise<void> {
  try {
    await clearOfflineCache();
  } finally {
    await call("/sign-out", { method: "POST", body: {} }).catch((error: unknown) => {
      // Already signed out (the session was revoked): nothing to end.
      if (!(error instanceof AuthError && error.status === 401)) throw error;
    });
  }
}
