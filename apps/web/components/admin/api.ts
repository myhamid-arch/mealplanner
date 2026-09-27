"use client";

// The typed contract client for the screens of this leaf (ARC-5: one contract; leaf-1.4.6 ADR-1)
// and plain-language messages for its problems (UX-7).
import { ApiProblem, createApiClient } from "@mealplanner/api-contract/client";
import { AuthError } from "./auth-client";

export const api = createApiClient({ baseUrl: "" });

/** A sentence for the person using the screen, from any error the client or fetch throws. */
export function problemMessage(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case "household_ambiguous":
        return "Your login belongs to more than one household, and this screen can only show one.";
      case "totp_required":
        return "This household requires two-step sign-in for admins. Turn it on in My account first.";
      case "household_suspended":
        return "This household is suspended. Contact whoever runs the site.";
      case "email_not_configured":
        return "Email is not set up on this server, so nothing can be emailed. Use a link or code instead.";
      case "forbidden_role":
        return "Only admins can do this.";
      case "unauthorized":
        return "You are signed out. Sign in again.";
      case "invalid_password":
        return "That password is not right.";
      case "invalid_credentials":
        return "That email and password don't match.";
      case "email_taken":
        return "An account with this email already exists.";
      case "invite_invalid":
        return "This invite has been used, revoked or has expired. Ask for a new one.";
      case "not_operator":
        return "This console is only for platform operators.";
      case "support_grant_required":
        return "This household has not granted support access, so its data stays private.";
      default: {
        const text = error.problem.detail ?? error.problem.title;
        return text === ""
          ? "Something went wrong."
          : `${text.charAt(0).toUpperCase()}${text.slice(1)}.`.replace(/\.\.$/, ".");
      }
    }
  }
  if (error instanceof TypeError)
    return "The server could not be reached. Check your connection and try again.";
  return error instanceof Error && error.message !== "" ? error.message : "Something went wrong.";
}

/** True for a 401 from either API: the session is gone (signed out, blocked or removed). */
export function isSignedOut(error: unknown): boolean {
  return (error instanceof ApiProblem || error instanceof AuthError) && error.status === 401;
}

/** Sends the browser to sign-in, coming back here afterwards. */
export function goToSignIn(): void {
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/sign-in?next=${encodeURIComponent(here)}`);
}
