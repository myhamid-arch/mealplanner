"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type SyntheticEvent } from "react";
import type { z } from "zod";
import { ApiProblem } from "@mealplanner/api-contract/client";
import {
  InviteAcceptBody,
  invitesAccept,
  invitesLookup,
  me,
  type InviteLookupDto,
  type MeDto,
} from "@mealplanner/api-contract/contract";
import type { HouseholdRole } from "@mealplanner/core/types";
import { ROUTES } from "../../../(shell)/_shell/nav";
import { api, problemMessage } from "../../../../components/admin/api";
import { signOut } from "../../../../components/admin/auth-client";
import { FormError, TextField } from "../../../../components/admin/field";
import {
  expiresIn,
  groupCode,
  passwordHint,
  ROLE_LABEL,
} from "../../../../components/admin/format";
import { Button } from "../../../../components/ui/button";
import { SkeletonBlock } from "../../../../components/ui/skeleton";

type Lookup = z.output<typeof InviteLookupDto>;
type Me = z.output<typeof MeDto>;

const ROLE_PROMISE: Readonly<Record<HouseholdRole, string>> = {
  admin: "You'll manage people, targets, settings and plans, and talk to the assistant.",
  member: "You'll see the family plan and your own plates, rate meals, and set your tastes.",
  kitchen: "You'll see cook sheets and recipes, and can flag missing ingredients.",
};

/** After joining: members and admins set their tastes (TastePhone), the kitchen gets its sheet. */
function nextPath(role: HouseholdRole): string {
  return role === "kitchen" ? ROUTES.kitchen : ROUTES.me;
}

type State =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; invite: Lookup; viewer: Me | null };

export function AcceptInvite({ code }: { readonly code: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [mode, setMode] = useState<"signup" | "existing">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const alive = { current: true };
    void (async () => {
      if (code.length !== 10) {
        setState({ kind: "invalid", message: "This invite code is not valid." });
        return;
      }
      try {
        const invite = await api.call(invitesLookup, { params: { code } });
        let viewer: Me | null = null;
        try {
          viewer = await api.call(me, {});
        } catch {
          viewer = null;
        }
        if (alive.current) setState({ kind: "ready", invite, viewer });
      } catch (err) {
        if (alive.current)
          setState({
            kind: "invalid",
            message:
              err instanceof ApiProblem && err.status === 410
                ? "This invite has been used, revoked or has expired. Ask whoever invited you for a new one."
                : problemMessage(err),
          });
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [code]);

  if (state.kind === "loading") return <SkeletonBlock label="Loading the invite" lines={5} />;
  if (state.kind === "invalid")
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[28px]">This invite can&rsquo;t be used</h1>
        <FormError>{state.message}</FormError>
        <Link href="/sign-in" className="font-extrabold">
          Go to sign in
        </Link>
      </div>
    );

  const { invite, viewer } = state;
  const displayName = invite.memberName ?? name.trim();

  async function accept(body: z.input<typeof InviteAcceptBody>) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.call(invitesAccept, { body });
      router.replace(nextPath(result.role));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiProblem && err.code === "email_taken") {
        setMode("existing");
        setError("You already have an account with this email. Enter its password to join.");
      } else setError(problemMessage(err));
      setBusy(false);
    }
  }

  function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    if (mode === "signup") {
      if (password.length < 8) {
        setError("The password needs at least 8 characters.");
        return;
      }
      void accept({
        code,
        signup: { email: email.trim(), password, name: displayName },
      });
    } else void accept({ code, credentials: { email: email.trim(), password } });
  }

  const hint = passwordHint(password);
  const signedIn = viewer !== null;

  return (
    <div className="flex flex-col gap-[18px]">
      <section
        aria-labelledby="invite-household"
        className="flex flex-col gap-2.5 rounded-[22px] bg-tomato-tint p-[22px] text-ink"
      >
        <span className="text-sm font-extrabold text-tomato-text">You&rsquo;re invited to</span>
        <h1 id="invite-household" className="text-[28px] leading-tight">
          {invite.householdName}
        </h1>
        <div className="flex flex-wrap gap-2">
          {invite.memberName !== null && (
            <span className="rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold text-ink">
              You are: {invite.memberName}
            </span>
          )}
          <span className="rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold text-ink">
            Role: {ROLE_LABEL[invite.role]}
          </span>
        </div>
        <p className="m-0 text-sm text-ink">{ROLE_PROMISE[invite.role]}</p>
      </section>

      {signedIn ? (
        <div className="flex flex-col gap-3">
          <p className="m-0">
            You&rsquo;re signed in as <strong>{viewer.user.name}</strong> ({viewer.user.email}).
          </p>
          <FormError>{error}</FormError>
          <Button
            size="lg"
            loading={busy}
            onClick={() => {
              void accept({ code });
            }}
            className="h-[54px] text-[17px]"
          >
            Join the household
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void signOut().finally(() => {
                window.location.reload();
              });
            }}
          >
            Not you? Sign out
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-[18px]" noValidate>
          {mode === "signup" && invite.memberName === null && (
            <TextField
              label="Your name"
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
              }}
            />
          )}
          <TextField
            label="Your email"
            name="email"
            type="email"
            autoComplete={mode === "signup" ? "email" : "username"}
            required
            value={email}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
            }}
          />
          <TextField
            label={mode === "signup" ? "Choose a password" : "Your password"}
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
            }}
            {...(mode === "signup"
              ? {
                  hint: (
                    <span className={hint.strong ? "text-basil-text" : undefined}>{hint.text}</span>
                  ),
                }
              : {})}
          />
          <FormError>{error}</FormError>
          <Button
            type="submit"
            size="lg"
            loading={busy}
            disabled={
              email.trim() === "" || password === "" || (mode === "signup" && displayName === "")
            }
            className="h-[54px] text-[17px]"
          >
            Join the household
          </Button>
          <p className="m-0 text-center text-sm">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link
                  href={`/sign-in?next=${encodeURIComponent(`/invite/${code}`)}`}
                  className="font-extrabold"
                >
                  Sign in first
                </Link>
              </>
            ) : (
              <button
                type="button"
                className="min-h-11 font-extrabold text-action"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
              >
                Create a new account instead
              </button>
            )}
          </p>
        </form>
      )}

      <div className="flex flex-col gap-2 rounded-[14px] bg-flour p-3.5 text-[13px] text-ink">
        <span>
          <strong>Invite code</strong>{" "}
          <span className="font-mono font-medium">{groupCode(code)}</span> ·{" "}
          {expiresIn(invite.expiresAt).toLowerCase()} · single use
        </span>
        <span>
          {invite.role === "kitchen"
            ? "Next: the cook sheet for today."
            : "Next: a 60-second “taste swipe” so your first plans already suit you."}
        </span>
      </div>
    </div>
  );
}
