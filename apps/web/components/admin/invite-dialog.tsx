"use client";

import { useEffect, useId, useState, type SyntheticEvent } from "react";
import type { z } from "zod";
import {
  changeSetsApply,
  invitesCreate,
  type InviteDto,
  type InviteExpiry,
} from "@mealplanner/api-contract/contract";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@mealplanner/core/types";
import { AVATAR_COLORS } from "@mealplanner/ui-tokens/tokens";
import { Button } from "../ui/button";
import { Dialog } from "../ui/sheet";
import { api, problemMessage } from "./api";
import { FormError, Notice, SelectField, TextField } from "./field";
import { expiresIn, groupCode, ROLE_DESCRIPTION, ROLE_LABEL } from "./format";
import { QrCode } from "./qr-code";

export type Invite = z.output<typeof InviteDto>;
type Expiry = z.output<typeof InviteExpiry>;

export interface TableMember {
  readonly memberId: string;
  readonly displayName: string;
  readonly color: string | null;
}

/** "Who are they at the table?" (InviteDialog.dc.html; leaf-1.4.6 SPEC-Q-8). */
type Seat = { kind: "member"; memberId: string } | { kind: "new" } | { kind: "staff" };

const EXPIRY_LABEL: Readonly<Record<Expiry, string>> = {
  "7d": "In 7 days",
  "24h": "In 24 hours",
  "30d": "In 30 days",
};

const CHOICE =
  "min-h-11 rounded-[12px] px-3.5 py-2.5 font-extrabold border-[1.5px] aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper";

/**
 * Invite someone (R2-ADM-2): bound to a role and optionally a member; sent by email, or shared as
 * a link, a code or a QR code; expires in 24 h, 7 d (default) or 30 d; single use.
 */
export function InviteDialog({
  open,
  onOpenChange,
  members,
  initialMemberId,
  onChanged,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Members without a login, who can be given one. */
  readonly members: readonly TableMember[];
  readonly initialMemberId: string | null;
  /** Called after an invite (and possibly a member) was created. */
  readonly onChanged: () => void;
}) {
  const [seat, setSeat] = useState<Seat>({ kind: "staff" });
  const [newName, setNewName] = useState("");
  const [role, setRole] = useState<HouseholdRole>("member");
  const [email, setEmail] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("7d");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ invite: Invite; emailedTo: string | null } | null>(null);
  const roleName = useId();

  // Each opening starts a fresh invite, seated at the member it was opened for.
  useEffect(() => {
    if (!open) return;
    const first = members[0];
    setSeat(
      initialMemberId !== null
        ? { kind: "member", memberId: initialMemberId }
        : first !== undefined
          ? { kind: "member", memberId: first.memberId }
          : { kind: "new" },
    );
    setRole("member");
    setNewName("");
    setEmail("");
    setExpiry("7d");
    setError(null);
    setBusy(false);
    setCreated(null);
  }, [open, initialMemberId, members]);

  const seatName =
    seat.kind === "member"
      ? (members.find((m) => m.memberId === seat.memberId)?.displayName ?? null)
      : seat.kind === "new"
        ? newName.trim() || null
        : null;

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    if (seat.kind === "new" && newName.trim() === "") {
      setError("Give the new person a name.");
      return;
    }
    setBusy(true);
    try {
      let memberId: string | null = seat.kind === "member" ? seat.memberId : null;
      if (seat.kind === "new") {
        memberId = crypto.randomUUID();
        const used = new Set(members.map((m) => m.color));
        const color = AVATAR_COLORS.find((c) => !used.has(c)) ?? AVATAR_COLORS[0];
        await api.call(changeSetsApply, {
          body: {
            summary: `Add ${newName.trim()} to the family`,
            ops: [
              {
                kind: "member.create",
                payload: { id: memberId, displayName: newName.trim(), color, isTargeted: false },
              },
            ],
          },
        });
      }
      const to = email.trim();
      const invite = await api.call(invitesCreate, {
        body: {
          role,
          memberId,
          expiresIn: expiry,
          channel: to === "" ? "link" : "email",
          ...(to === "" ? {} : { email: to }),
        },
      });
      setCreated({ invite, emailedTo: to === "" ? null : to });
      onChanged();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = created === null ? "Invite someone" : "Invite ready";
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width={820}>
      {created !== null ? (
        <InviteShare
          invite={created.invite}
          emailedTo={created.emailedTo}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : (
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="flex flex-col gap-[22px]"
          noValidate
        >
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 p-0 font-extrabold">Who are they at the table?</legend>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  key={m.memberId}
                  type="button"
                  aria-pressed={seat.kind === "member" && seat.memberId === m.memberId}
                  onClick={() => {
                    setSeat({ kind: "member", memberId: m.memberId });
                  }}
                  className={`${CHOICE} border-line-strong bg-card text-ink`}
                >
                  {m.displayName}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={seat.kind === "new"}
                onClick={() => {
                  setSeat({ kind: "new" });
                }}
                className={`${CHOICE} border-line-strong bg-card text-ink`}
              >
                A new person
              </button>
              <button
                type="button"
                aria-pressed={seat.kind === "staff"}
                onClick={() => {
                  setSeat({ kind: "staff" });
                  setRole((r) => (r === "member" ? "kitchen" : r));
                }}
                className={`${CHOICE} border-line-strong bg-card text-ink`}
              >
                Doesn&rsquo;t eat here (staff)
              </button>
            </div>
            {seat.kind === "new" && (
              <TextField
                label="Their name"
                name="newName"
                autoComplete="off"
                maxLength={80}
                value={newName}
                onChange={(e) => {
                  setNewName(e.currentTarget.value);
                }}
                hint="Added to the family without targets; set targets on their profile later."
              />
            )}
          </fieldset>

          <fieldset className="m-0 flex flex-col border-0 p-0">
            <legend className="mb-2.5 p-0 font-extrabold">What can they do?</legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {HOUSEHOLD_ROLES.map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl bg-card p-4 ${
                    role === r
                      ? "border-[2.5px] border-action"
                      : "border-[1.5px] border-line-strong"
                  }`}
                >
                  <span className="flex items-center gap-2 font-extrabold">
                    <input
                      type="radio"
                      name={roleName}
                      value={r}
                      checked={role === r}
                      onChange={() => {
                        setRole(r);
                      }}
                      className="size-[18px] accent-[var(--action)]"
                    />
                    {ROLE_LABEL[r]}
                  </span>
                  <span className="text-sm text-ink-soft">{ROLE_DESCRIPTION[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField
              label="Send to email (optional)"
              name="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.currentTarget.value);
              }}
              hint="Leave empty to share a link, code or QR code yourself."
            />
            <SelectField
              label="Link expires"
              name="expiry"
              value={expiry}
              onChange={(e) => {
                setExpiry(e.currentTarget.value as Expiry);
              }}
            >
              {(Object.keys(EXPIRY_LABEL) as Expiry[]).map((k) => (
                <option key={k} value={k}>
                  {EXPIRY_LABEL[k]}
                </option>
              ))}
            </SelectField>
          </div>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              {email.trim() !== ""
                ? `Send invite${seatName === null ? "" : ` to ${seatName}`}`
                : "Create invite link"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** The link, code and QR code of an open invite, with Copy link (InviteDialog.dc.html). */
export function InviteShare({
  invite,
  emailedTo,
  onDone,
}: {
  readonly invite: Invite;
  readonly emailedTo: string | null;
  readonly onDone: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied("Link copied.");
    } catch {
      setCopied("Copying is blocked here; select the link and copy it.");
    }
  }
  return (
    <div className="flex flex-col gap-5">
      {emailedTo !== null && <Notice>Invite emailed to {emailedTo}.</Notice>}
      <div className="flex flex-col gap-5 md:flex-row md:items-stretch">
        <div className="flex grow flex-col gap-3">
          <p className="m-0">
            {ROLE_LABEL[invite.role]} invite · {expiresIn(invite.expiresAt).toLowerCase()} · single
            use
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-bold">Invite code</span>
            <span
              className="font-mono text-[22px] font-medium tracking-wider"
              data-testid="invite-code"
            >
              {groupCode(invite.code)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 rounded-[12px] bg-flour px-3.5 py-3">
            <span className="min-w-0 grow font-mono text-sm break-all" data-testid="invite-link">
              {invite.link}
            </span>
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              className="min-h-11 rounded-[10px] bg-ink px-3.5 font-extrabold text-paper"
            >
              Copy link
            </button>
          </div>
          <p role="status" className="m-0 min-h-5 text-sm font-bold text-ink-soft">
            {copied}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2 rounded-2xl border-[1.5px] border-line bg-card p-3.5 md:w-[190px]">
          <QrCode value={invite.link} label="QR code for the invite link" />
          <span className="text-center text-[13px] font-bold text-ink-soft">
            Scan to join on a phone
          </span>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}
