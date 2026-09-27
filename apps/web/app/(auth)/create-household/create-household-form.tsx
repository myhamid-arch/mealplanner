"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SyntheticEvent } from "react";
import { changeSetsApply, signup } from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../../components/admin/api";
import { FormError, SelectField, TextField } from "../../../components/admin/field";
import { passwordHint } from "../../../components/admin/format";
import { Button } from "../../../components/ui/button";
import { ApiProblem } from "@mealplanner/api-contract/client";

/** Where a new admin goes next: the five-question set-up (1.4.3, R2-ONB-1). */
const NEXT = "/onboarding";

export function CreateHouseholdForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [area, setArea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(password);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    if (password.length < 8) {
      setError("The password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.call(signup, {
        body: {
          email: email.trim(),
          password,
          name: name.trim(),
          householdName: householdName.trim(),
        },
      });
    } catch (err) {
      setEmailTaken(err instanceof ApiProblem && err.code === "email_taken");
      setError(problemMessage(err));
      setBusy(false);
      return;
    }
    // The area helps recipe generation pick ingredients you can buy (02 household.region_note).
    if (area.trim() !== "") {
      try {
        await api.call(changeSetsApply, {
          body: {
            summary: "Set the household's area",
            ops: [{ kind: "household.update", payload: { regionNote: area.trim() } }],
          },
        });
      } catch {
        // The household exists; the area can be set in Settings. Carry on to set-up.
      }
    }
    router.replace(NEXT);
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-[22px]"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[30px] lg:text-[34px]">Create your household</h1>
        <p className="m-0 text-base text-ink-soft">
          You&rsquo;ll be the first admin. You can invite other admins, family members and kitchen
          staff next.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
        <TextField
          label="Password"
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
          label="Household name"
          name="householdName"
          required
          maxLength={100}
          placeholder="e.g. Khalifa City home"
          value={householdName}
          onChange={(e) => {
            setHouseholdName(e.currentTarget.value);
          }}
        />
        <SelectField label="Country" name="country" defaultValue="AE">
          <option value="AE">United Arab Emirates</option>
        </SelectField>
        <TextField
          label="Area (helps pick ingredients you can buy)"
          name="area"
          maxLength={500}
          placeholder="e.g. Khalifa City, Abu Dhabi"
          value={area}
          onChange={(e) => {
            setArea(e.currentTarget.value);
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-flour px-4 py-3.5 text-sm text-ink">
        <span className="font-extrabold">Set automatically:</span>
        <span>Units kg · g · L · ml</span>
        <span aria-hidden>·</span>
        <span>Time zone Asia/Dubai</span>
        <span aria-hidden>·</span>
        <span>Week starts Monday</span>
        <span className="text-ink-soft md:ml-auto">Change any of these later in Settings</span>
      </div>
      {error !== null && (
        <FormError>
          {error}
          {emailTaken && (
            <>
              {" "}
              <Link href="/sign-in" className="text-pomegranate-text underline">
                Sign in instead
              </Link>
            </>
          )}
        </FormError>
      )}
      <div className="flex flex-col-reverse items-stretch gap-4 md:flex-row md:items-center md:justify-between">
        <Link href="/sign-in" className="min-h-11 content-center text-center font-extrabold">
          I already have an account
        </Link>
        <Button
          type="submit"
          size="lg"
          loading={busy}
          disabled={
            name.trim() === "" ||
            email.trim() === "" ||
            householdName.trim() === "" ||
            password.length === 0
          }
          className="h-[52px] px-7 text-[17px]"
        >
          Create household
        </Button>
      </div>
    </form>
  );
}
