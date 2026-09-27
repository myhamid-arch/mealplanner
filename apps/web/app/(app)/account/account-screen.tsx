"use client";

import Link from "next/link";
import { useState, type SyntheticEvent, type ReactNode } from "react";
import type { z } from "zod";
import {
  accountDelete,
  accountGet,
  accountNotificationsSet,
  accountPassword,
  accountSessionRevoke,
  accountSessions,
  accountTotpDisable,
  accountTotpEnable,
  accountTotpVerify,
  accountUpdate,
  me,
  membersGet,
  type AccountDto,
  type MeDto,
  type SessionRowDto,
} from "@mealplanner/api-contract/contract";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { api, problemMessage } from "../../../components/admin/api";
import {
  AuthError,
  hasPassword,
  requestPasswordReset,
  signOut,
} from "../../../components/admin/auth-client";
import { DangerButton } from "../../../components/admin/danger-button";
import {
  FormError,
  Notice,
  SectionLabel,
  TextField,
  ToggleRow,
} from "../../../components/admin/field";
import {
  deviceLabel,
  lastActive,
  PASSWORD_REMOVED_TEXT,
  passwordHint,
  ROLE_LABEL,
} from "../../../components/admin/format";
import { LoadError } from "../../../components/admin/load-error";
import { QrCode } from "../../../components/admin/qr-code";
import { useLoad } from "../../../components/admin/use-load";
import { Avatar } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";
import { Dialog } from "../../../components/ui/sheet";
import { SkeletonBlock } from "../../../components/ui/skeleton";

type Account = z.output<typeof AccountDto>;
type Me = z.output<typeof MeDto>;
type SessionRow = z.output<typeof SessionRowDto>;

interface Data {
  account: Account;
  me: Me;
  sessions: SessionRow[];
  passwordSet: boolean;
  memberName: string | null;
  memberColor: string | null;
}

/** Notification preferences (leaf-1.4.6 SPEC-Q-15); absent keys are on. */
const NOTIFICATIONS = [
  { key: "meal_rating_reminder", label: "After-meal rating reminder", adminOnly: false },
  { key: "assistant_proposals", label: "New proposals from the assistant", adminOnly: true },
] as const;

type DialogKind = null | "name" | "password" | "totp-on" | "totp-off" | "delete";

const LINK_BUTTON = "min-h-11 font-extrabold text-action hover:text-action-hover";

export function AccountScreen({ passwordRemoved }: { readonly passwordRemoved: boolean }) {
  const load = useLoad<Data>(async () => {
    const [account, who, sessions, passwordSet] = await Promise.all([
      api.call(accountGet, {}),
      api.call(me, {}),
      api.call(accountSessions, {}),
      hasPassword(),
    ]);
    const membership = who.memberships.find((m) => m.status !== "blocked") ?? null;
    let memberName: string | null = null;
    let memberColor: string | null = null;
    if (membership?.memberId != null) {
      try {
        const m = await api.call(membersGet, { params: { id: membership.memberId } });
        memberName = m.displayName;
        memberColor = m.color;
      } catch {
        // The member may be archived or out of reach for this role; the row just omits it.
      }
    }
    return {
      account,
      me: who,
      sessions: sessions.sessions ?? [],
      passwordSet,
      memberName,
      memberColor,
    };
  });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (load.status === "loading")
    return (
      <Frame>
        <SkeletonBlock label="Loading your account" lines={8} />
      </Frame>
    );
  if (load.status === "error")
    return (
      <Frame>
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      </Frame>
    );

  const { account, me: who, sessions, passwordSet, memberName, memberColor } = load.data;
  const membership = who.memberships.find((m) => m.status !== "blocked") ?? null;
  const isAdmin = membership?.role === "admin";
  const prefs = new Map(account.notifications.map((n) => [n.key, n.enabled]));
  const current = sessions.find((s) => s.current);
  const others = sessions.filter((s) => !s.current);

  async function act(key: string, fn: () => Promise<string | null>) {
    setError(null);
    setStatus(null);
    setBusy(key);
    try {
      setStatus(await fn());
      await load.reload();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onSignOut() {
    setBusy("sign-out");
    try {
      await signOut();
    } finally {
      window.location.assign("/sign-in?notice=signed-out");
    }
  }

  const close = () => {
    setDialog(null);
  };

  return (
    <Frame>
      {(passwordRemoved || !passwordSet) && (
        <p
          role="alert"
          data-testid="password-removed-account"
          className="m-0 flex items-start gap-2.5 rounded-[14px] bg-saffron-tint px-4 py-3.5 font-bold text-saffron-text"
        >
          <Icon name="lock" size={20} className="mt-0.5 shrink-0" />
          <span>
            {passwordSet
              ? `${PASSWORD_REMOVED_TEXT}.`
              : passwordRemoved
                ? `${PASSWORD_REMOVED_TEXT}. Use “Set a new password” below.`
                : "Your account has no password; you sign in by email link. You can set one below."}
          </span>
        </p>
      )}
      <Notice>{status}</Notice>
      <FormError>{error}</FormError>

      <div className="flex items-center gap-3 rounded-[18px] bg-card p-3.5 shadow-card">
        <Avatar
          name={account.user.name}
          size={56}
          color={isAvatarColor(memberColor) ? memberColor : null}
          colorKey={membership?.memberId ?? account.user.id}
        />
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-[17px] font-extrabold">{account.user.name}</span>
          <span className="truncate text-[13px] text-ink-soft">{account.user.email}</span>
          {membership !== null && (
            <span className="text-[13px] font-extrabold text-sea-text">
              {ROLE_LABEL[membership.role]}
              {memberName === null ? " · doesn't eat here" : ` · eats as ${memberName}`}
            </span>
          )}
        </span>
        <button
          type="button"
          className={`${LINK_BUTTON} text-sm`}
          onClick={() => {
            setDialog("name");
          }}
        >
          Edit
        </button>
      </div>

      <ul className="m-0 flex list-none flex-col rounded-[18px] bg-card p-0 shadow-card">
        <Row id="password" label="Password">
          {passwordSet ? (
            <button
              type="button"
              className={`${LINK_BUTTON} text-sm`}
              onClick={() => {
                setDialog("password");
              }}
            >
              Change
            </button>
          ) : (
            <Button
              size="md"
              loading={busy === "set-password"}
              onClick={() => {
                void act("set-password", async () => {
                  await requestPasswordReset(account.user.email);
                  return `A link to set your password is on its way to ${account.user.email}.`;
                });
              }}
            >
              Set a new password
            </Button>
          )}
        </Row>
        <Row label="Two-step sign-in">
          <span className="text-sm text-ink-soft">
            {account.twoFactorEnabled ? "On" : "Off"} ·{" "}
            <button
              type="button"
              className={LINK_BUTTON}
              onClick={() => {
                setDialog(account.twoFactorEnabled ? "totp-off" : "totp-on");
              }}
            >
              {account.twoFactorEnabled ? "Turn off" : "Turn on"}
            </button>
          </span>
        </Row>
        <Row label="Household" last>
          <span className="text-sm text-ink-soft">{membership?.householdName ?? "None"}</span>
        </Row>
      </ul>

      <SectionLabel>Signed in on</SectionLabel>
      <ul className="m-0 flex list-none flex-col rounded-[18px] bg-card p-0 shadow-card">
        {current !== undefined && (
          <li className="flex items-center gap-2.5 border-b border-flour px-4 py-3 last:border-b-0">
            <span className="flex grow flex-col">
              <span className="font-extrabold">{deviceLabel(current.userAgent)}</span>
              <span className="text-[13px] font-bold text-basil-text">This device</span>
            </span>
          </li>
        )}
        {others.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-2.5 border-b border-flour px-4 py-3 last:border-b-0"
          >
            <span className="flex min-w-0 grow flex-col">
              <span className="font-extrabold">{deviceLabel(s.userAgent)}</span>
              <span className="text-[13px] text-ink-soft">
                {s.ipAddress === null ? "" : `${s.ipAddress} · `}
                signed in {lastActive(s.createdAt).toLowerCase()}
              </span>
            </span>
            <Button
              variant="secondary"
              loading={busy === s.id}
              aria-label={`Sign out ${deviceLabel(s.userAgent)}`}
              onClick={() => {
                void act(s.id, async () => {
                  await api.call(accountSessionRevoke, { params: { id: s.id } });
                  return `Signed out of ${deviceLabel(s.userAgent)}.`;
                });
              }}
            >
              Sign out
            </Button>
          </li>
        ))}
      </ul>

      <SectionLabel>Notifications</SectionLabel>
      <div className="flex flex-col rounded-[18px] bg-card shadow-card">
        {NOTIFICATIONS.filter((n) => !n.adminOnly || isAdmin).map((n, i, all) => (
          <ToggleRow
            key={n.key}
            label={n.label}
            checked={prefs.get(n.key) ?? true}
            disabled={busy === "notifications"}
            className={`px-4 py-3 ${i < all.length - 1 ? "border-b border-flour" : ""}`}
            onChange={(enabled) => {
              void act("notifications", async () => {
                const next = NOTIFICATIONS.map((x) => ({
                  key: x.key,
                  enabled: x.key === n.key ? enabled : (prefs.get(x.key) ?? true),
                }));
                await api.call(accountNotificationsSet, { body: { notifications: next } });
                return null;
              });
            }}
          />
        ))}
      </div>

      {isAdmin && (
        <Link
          href="/account/diagnostics"
          className="flex min-h-11 items-center gap-2 font-extrabold"
        >
          Diagnostics: AI calls and failed jobs
          <Icon name="chevronRight" size={18} />
        </Link>
      )}

      <div className="flex flex-wrap justify-between gap-3 px-1 pt-1">
        <button
          type="button"
          className={LINK_BUTTON}
          disabled={busy === "sign-out"}
          onClick={() => {
            void onSignOut();
          }}
        >
          Sign out
        </button>
        <button
          type="button"
          className="min-h-11 font-extrabold text-pomegranate-text"
          onClick={() => {
            setDialog("delete");
          }}
        >
          Delete my account
        </button>
      </div>

      {dialog === "name" && (
        <NameDialog
          name={account.user.name}
          onClose={close}
          onSaved={(n) => {
            close();
            setStatus(`Your name is now ${n}.`);
            void load.reload();
          }}
        />
      )}
      {dialog === "password" && (
        <PasswordDialog
          onClose={close}
          onSaved={() => {
            close();
            setStatus("Password changed. Other devices are signed out.");
            void load.reload();
          }}
        />
      )}
      {dialog === "totp-on" && (
        <TotpOnDialog
          onClose={close}
          onDone={() => {
            close();
            setStatus("Two-step sign-in is on. Keep your backup codes somewhere safe.");
            void load.reload();
          }}
        />
      )}
      {dialog === "totp-off" && (
        <PasswordConfirmDialog
          title="Turn off two-step sign-in"
          intro="Signing in will need only your password again."
          action="Turn off"
          onClose={close}
          submit={async (password) => {
            await api.call(accountTotpDisable, { body: { password } });
          }}
          onDone={() => {
            close();
            setStatus("Two-step sign-in is off.");
            void load.reload();
          }}
        />
      )}
      {dialog === "delete" && (
        <PasswordConfirmDialog
          title="Delete my account"
          intro="Your login is removed from every household and your sessions end. Reviews you wrote stay, without your name. This can't be undone."
          action="Delete my account"
          danger
          onClose={close}
          submit={async (password) => {
            await api.call(accountDelete, { body: { password } });
          }}
          onDone={() => {
            void signOut()
              .catch(() => undefined)
              .finally(() => {
                window.location.assign("/sign-in?notice=deleted");
              });
          }}
        />
      )}
    </Frame>
  );
}

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3.5">
      <h1 className="text-[28px]">My account</h1>
      {children}
    </div>
  );
}

function Row({
  id,
  label,
  last = false,
  children,
}: {
  readonly id?: string;
  readonly label: string;
  readonly last?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <li
      id={id}
      className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2 ${last ? "" : "border-b border-flour"}`}
    >
      <span className="font-bold">{label}</span>
      {children}
    </li>
  );
}

function DialogFooter({
  onCancel,
  children,
}: {
  readonly onCancel: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-3">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      {children}
    </div>
  );
}

function NameDialog({
  name,
  onClose,
  onSaved,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onSaved: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await api.call(accountUpdate, { body: { name: value.trim() } });
      onSaved(u.name);
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Your name"
      width={520}
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <TextField
          label="Name"
          autoComplete="name"
          maxLength={100}
          value={value}
          onChange={(e) => {
            setValue(e.currentTarget.value);
          }}
        />
        <FormError>{error}</FormError>
        <DialogFooter onCancel={onClose}>
          <Button type="submit" loading={busy} disabled={value.trim() === ""}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function PasswordDialog({
  onClose,
  onSaved,
}: {
  readonly onClose: () => void;
  readonly onSaved: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(next);
  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setError("The new password needs at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.call(accountPassword, { body: { currentPassword: current, newPassword: next } });
      onSaved();
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Change password"
      description="Other devices are signed out afterwards."
      width={520}
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.currentTarget.value);
          }}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={next}
          onChange={(e) => {
            setNext(e.currentTarget.value);
          }}
          hint={<span className={hint.strong ? "text-basil-text" : undefined}>{hint.text}</span>}
        />
        <FormError>{error}</FormError>
        <DialogFooter onCancel={onClose}>
          <Button type="submit" loading={busy} disabled={current === "" || next === ""}>
            Change password
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function PasswordConfirmDialog({
  title,
  intro,
  action,
  danger = false,
  onClose,
  submit,
  onDone,
}: {
  readonly title: string;
  readonly intro: string;
  readonly action: string;
  readonly danger?: boolean;
  readonly onClose: () => void;
  readonly submit: (password: string) => Promise<void>;
  readonly onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit(password);
      onDone();
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      description={intro}
      width={560}
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.currentTarget.value);
          }}
        />
        <FormError>{error}</FormError>
        <DialogFooter onCancel={onClose}>
          {danger ? (
            <DangerButton busy={busy}>{action}</DangerButton>
          ) : (
            <Button type="submit" loading={busy} disabled={password === ""}>
              {action}
            </Button>
          )}
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Two-step set-up (R2-ADM-5): password → scan the QR code, keep the backup codes → a code. */
function TotpOnDialog({
  onClose,
  onDone,
}: {
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ totpUri: string; backupCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.call(accountTotpEnable, { body: { password } }));
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The server replaces this session and sets the new cookie in the response (1.4.1 ADR-1).
      await api.call(accountTotpVerify, { body: { code } });
      onDone();
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }

  const secret = setup === null ? null : new URL(setup.totpUri).searchParams.get("secret");
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Turn on two-step sign-in"
      width={640}
    >
      {setup === null ? (
        <form
          onSubmit={(e) => {
            void start(e);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="m-0 text-ink-soft">
            After this, signing in with a password also asks for a code from an authenticator app.
          </p>
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.currentTarget.value);
            }}
          />
          <FormError>{error}</FormError>
          <DialogFooter onCancel={onClose}>
            <Button type="submit" loading={busy} disabled={password === ""}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            void verify(e);
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl border-[1.5px] border-line bg-card p-3.5">
              <QrCode value={setup.totpUri} label="QR code to add Mise to an authenticator app" />
              <span className="text-center text-[13px] font-bold text-ink-soft">
                Scan with your authenticator app
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-2 text-sm">
              {secret !== null && (
                <p className="m-0">
                  Or enter this key:{" "}
                  <span className="font-mono font-medium break-all" data-testid="totp-secret">
                    {secret}
                  </span>
                </p>
              )}
              <p className="m-0 font-bold">
                Backup codes (each works once if you lose your phone):
              </p>
              <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0 font-mono">
                {setup.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
          <TextField
            label="Code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            mono
            value={code}
            onChange={(e) => {
              setCode(e.currentTarget.value.replace(/\D/g, ""));
            }}
          />
          <FormError>{error}</FormError>
          <DialogFooter onCancel={onClose}>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Turn on
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
