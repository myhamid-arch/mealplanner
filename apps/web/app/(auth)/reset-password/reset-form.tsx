"use client";

import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";
import { AuthError, resetPassword } from "../../../components/admin/auth-client";
import { FormError, TextField } from "../../../components/admin/field";
import { passwordHint } from "../../../components/admin/format";
import { Button } from "../../../components/ui/button";

export function ResetForm({ token }: { readonly token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(password);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("The password needs at least 8 characters.");
      return;
    }
    if (password !== again) {
      setError("The two passwords are different.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      // The library signs the account out everywhere after a reset.
      router.replace("/sign-in?notice=password-set");
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-[18px]"
      noValidate
    >
      <h1 className="text-[32px] lg:text-4xl">Choose a new password</h1>
      <p className="m-0 text-ink-soft">
        After this you&rsquo;ll be signed out on every device; sign in with the new password.
      </p>
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={128}
        value={password}
        onChange={(e) => {
          setPassword(e.currentTarget.value);
        }}
        hint={<span className={hint.strong ? "text-basil-text" : undefined}>{hint.text}</span>}
      />
      <TextField
        label="New password again"
        name="again"
        type="password"
        autoComplete="new-password"
        required
        value={again}
        onChange={(e) => {
          setAgain(e.currentTarget.value);
        }}
      />
      <FormError>{error}</FormError>
      <Button type="submit" size="lg" loading={busy} disabled={password === "" || again === ""}>
        Set password
      </Button>
    </form>
  );
}
