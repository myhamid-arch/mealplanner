"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";
import {
  AuthError,
  requestPasswordReset,
  requestSignInLink,
  signInWithPassword,
  verifyTwoStepCode,
} from "../../../components/admin/auth-client";
import { destinationAfterSignIn } from "../../../components/admin/destination";
import { FormError, Notice, TextField } from "../../../components/admin/field";
import { normaliseCode } from "../../../components/admin/format";
import { Button } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";

type Mode = "password" | "two-step" | "forgot";

function messageOf(error: unknown): string {
  if (error instanceof AuthError) return error.message;
  if (error instanceof TypeError)
    return "The server could not be reached. Check your connection and try again.";
  return "Something went wrong. Try again.";
}

export function SignInForm({
  next,
  notice,
}: {
  readonly next: string | null;
  readonly notice: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState("");
  const [trust, setTrust] = useState(false);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(notice);
  const [busy, setBusy] = useState<null | "password" | "link" | "code" | "reset">(null);

  async function finish() {
    router.replace(await destinationAfterSignIn(next));
    router.refresh();
  }

  async function onPassword(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    setBusy("password");
    try {
      const result = await signInWithPassword({ email, password, rememberMe: remember });
      if (result.kind === "two-step") {
        setMode("two-step");
        setBusy(null);
        return;
      }
      await finish();
    } catch (err) {
      setError(messageOf(err));
      setBusy(null);
    }
  }

  async function onCode(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setBusy("code");
    try {
      await verifyTwoStepCode({ code, trustDevice: trust });
      await finish();
    } catch (err) {
      setError(messageOf(err));
      setBusy(null);
    }
  }

  async function onLink() {
    setError(null);
    setSent(null);
    if (email.trim() === "") {
      setError("Enter your email above, then ask for the link.");
      return;
    }
    setBusy("link");
    try {
      await requestSignInLink(email, next);
      setSent(
        `If ${email.trim()} has an account, a sign-in link is on its way. It works once, for 15 minutes.`,
      );
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function onReset(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setSent(null);
    setBusy("reset");
    try {
      await requestPasswordReset(email);
      setSent(`If ${email.trim()} has an account, a link to choose a new password is on its way.`);
      setMode("password");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  function onInvite(e: SyntheticEvent) {
    e.preventDefault();
    const c = normaliseCode(invite);
    if (c.length !== 10) {
      setInviteError("An invite code has 10 letters and numbers.");
      return;
    }
    setInviteError(null);
    router.push(`/invite/${c}`);
  }

  if (mode === "two-step")
    return (
      <form
        onSubmit={(e) => {
          void onCode(e);
        }}
        className="flex flex-col gap-[18px]"
        noValidate
      >
        <h1 className="text-[32px] lg:text-4xl">Two-step sign-in</h1>
        <p className="m-0 text-ink-soft">
          Enter the 6-digit code from your authenticator app for {email.trim()}.
        </p>
        <TextField
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          mono
          value={code}
          onChange={(e) => {
            setCode(e.currentTarget.value.replace(/\D/g, ""));
          }}
          autoFocus
        />
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={trust}
            onChange={(e) => {
              setTrust(e.currentTarget.checked);
            }}
            className="size-[18px] accent-[var(--action)]"
          />
          Don&rsquo;t ask again on this device for 30 days
        </label>
        <FormError>{error}</FormError>
        <Button type="submit" size="lg" loading={busy === "code"} disabled={code.length !== 6}>
          Verify and sign in
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode("password");
            setCode("");
            setError(null);
          }}
        >
          Use a different account
        </Button>
      </form>
    );

  if (mode === "forgot")
    return (
      <form
        onSubmit={(e) => {
          void onReset(e);
        }}
        className="flex flex-col gap-[18px]"
        noValidate
      >
        <h1 className="text-[32px] lg:text-4xl">Forgot your password?</h1>
        <p className="m-0 text-ink-soft">
          We&rsquo;ll email you a link to choose a new one. It works once, for an hour.
        </p>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
          }}
        />
        <FormError>{error}</FormError>
        <Button type="submit" size="lg" loading={busy === "reset"} disabled={email.trim() === ""}>
          Email me a reset link
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMode("password");
            setError(null);
          }}
        >
          Back to sign in
        </Button>
      </form>
    );

  return (
    <div className="flex flex-col gap-[18px]">
      <form
        onSubmit={(e) => {
          void onPassword(e);
        }}
        className="flex flex-col gap-[18px]"
        noValidate
      >
        <h1 className="text-[32px] lg:text-4xl">Welcome back</h1>
        <Notice>{sent}</Notice>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
          }}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <label className="flex min-h-11 items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                setRemember(e.currentTarget.checked);
              }}
              className="size-[18px] accent-[var(--action)]"
            />
            Keep me signed in on this device
          </label>
          <button
            type="button"
            className="min-h-11 font-bold text-action underline-offset-2 hover:text-action-hover hover:underline"
            onClick={() => {
              setMode("forgot");
              setError(null);
              setSent(null);
            }}
          >
            Forgot password?
          </button>
        </div>
        <FormError>{error}</FormError>
        <Button
          type="submit"
          size="lg"
          loading={busy === "password"}
          disabled={email.trim() === "" || password === ""}
          className="h-[52px] text-[17px]"
        >
          Sign in
        </Button>
      </form>
      <div aria-hidden className="flex items-center gap-3 text-[13px] font-bold text-ink-muted">
        <span className="h-px grow bg-line" />
        or
        <span className="h-px grow bg-line" />
      </div>
      <button
        type="button"
        onClick={() => {
          void onLink();
        }}
        disabled={busy !== null}
        aria-busy={busy === "link" || undefined}
        className="flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] border-[1.5px] border-ink bg-card font-extrabold text-ink hover:bg-flour disabled:opacity-60"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 6h18v12H3zM3 7l9 6l9-6" />
        </svg>
        Email me a one-time sign-in link
      </button>
      <form
        onSubmit={onInvite}
        className="mt-2 flex flex-col gap-2.5 rounded-[14px] bg-flour p-4"
        noValidate
      >
        <h2 className="font-body text-[15px] font-extrabold">Got an invite code?</h2>
        <div className="flex gap-2">
          <TextField
            label="Invite code"
            hideLabel
            name="invite"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. KHL-7Q4-M2PA"
            mono
            className="grow"
            value={invite}
            onChange={(e) => {
              setInvite(e.currentTarget.value);
            }}
            {...(inviteError === null ? {} : { error: inviteError })}
          />
          <button
            type="submit"
            className="flex h-12 min-w-11 items-center gap-1.5 self-start rounded-[12px] bg-ink px-4 font-extrabold text-paper"
          >
            Join
            <Icon name="arrowRight" size={18} />
          </button>
        </div>
      </form>
      <p className="m-0 text-center text-[15px]">
        New here?{" "}
        <Link href="/create-household" className="font-extrabold">
          Create a household
        </Link>
      </p>
    </div>
  );
}
