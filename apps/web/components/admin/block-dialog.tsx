"use client";

import { useEffect, useId, useState, type SyntheticEvent } from "react";
import { accessBlock, accessRemove } from "@mealplanner/api-contract/contract";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";
import { Dialog } from "../ui/sheet";
import { isAvatarColor } from "@mealplanner/ui-tokens/tokens";
import { api, problemMessage } from "./api";
import { DangerButton } from "./danger-button";
import { FormError, TextField } from "./field";
import { plural, ROLE_LABEL } from "./format";
import type { HouseholdRole } from "@mealplanner/core/types";

export interface LoginTarget {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: HouseholdRole;
  readonly memberId: string | null;
  readonly memberName: string | null;
  readonly memberColor: string | null;
}

export type BlockAction = "block" | "remove";

/**
 * Block or remove a login (BlockDialog.dc.html, R2-ADM-4). Block ends every session now and
 * refuses sign-in until unblocked; remove deletes the login from the household and can archive
 * the member. Both take an optional admin-only reason and are logged as change sets.
 */
export function BlockDialog({
  target,
  initial,
  onOpenChange,
  onDone,
}: {
  /** The login; null closes the dialog. */
  readonly target: LoginTarget | null;
  readonly initial: BlockAction;
  readonly onOpenChange: (open: boolean) => void;
  /** Called with a sentence for the page's status line. */
  readonly onDone: (message: string) => void;
}) {
  const [action, setAction] = useState<BlockAction>(initial);
  const [archive, setArchive] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const group = useId();

  useEffect(() => {
    setAction(initial);
    setArchive(false);
    setReason("");
    setError(null);
    setBusy(false);
  }, [target, initial]);

  if (target === null) return null;
  const who = target.name;
  const eatsAs = target.memberName === null ? "doesn't eat here" : `eats as ${target.memberName}`;

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    if (target === null) return;
    setError(null);
    setBusy(true);
    const why = reason.trim();
    try {
      if (action === "block") {
        const r = await api.call(accessBlock, {
          params: { userId: target.userId },
          body: why === "" ? {} : { reason: why },
        });
        onDone(
          `${who} is blocked. Signed out of ${plural(r.sessionsRevoked, "device", "devices")}.`,
        );
      } else {
        const r = await api.call(accessRemove, {
          params: { userId: target.userId },
          body: { archiveMember: archive, ...(why === "" ? {} : { reason: why }) },
        });
        onDone(
          `${who} is removed from the household${archive ? " and no longer planned for" : ""}. Signed out of ${plural(r.sessionsRevoked, "device", "devices")}.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      setError(problemMessage(err));
      setBusy(false);
    }
  }

  const card = (selected: boolean) =>
    `flex cursor-pointer flex-col gap-2.5 rounded-[18px] bg-card p-[18px] ${
      selected ? "border-[2.5px] border-action" : "border-[1.5px] border-line-strong"
    }`;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`${who}'s login`}
      description={`${target.email} · ${ROLE_LABEL[target.role]} · ${eatsAs}`}
      width={860}
    >
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="flex items-center gap-3.5">
          <Avatar
            name={who}
            size={56}
            color={isAvatarColor(target.memberColor) ? target.memberColor : null}
            colorKey={target.memberId ?? target.userId}
          />
          <span className="text-ink-soft">What should happen to this login?</span>
        </div>
        <div
          role="radiogroup"
          aria-label="Block or remove"
          className="grid grid-cols-1 gap-3.5 md:grid-cols-2"
        >
          <label className={card(action === "block")}>
            <span className="flex items-center gap-2 text-lg font-extrabold">
              <input
                type="radio"
                name={group}
                checked={action === "block"}
                onChange={() => {
                  setAction("block");
                }}
                className="size-5 accent-[var(--action)]"
              />
              Block (reversible)
            </span>
            <span className="text-sm text-ink-soft">
              Signed out on every device now. Can&rsquo;t sign in until unblocked.
            </span>
            <span className="text-sm text-ink-soft">
              {target.memberName === null
                ? "Their history stays, and you can unblock at any time."
                : `${target.memberName} still gets meals planned, their reviews stay, and you can unblock at any time.`}
            </span>
          </label>
          <label className={card(action === "remove")}>
            <span className="flex items-center gap-2 text-lg font-extrabold">
              <input
                type="radio"
                name={group}
                checked={action === "remove"}
                onChange={() => {
                  setAction("remove");
                }}
                className="size-5 accent-[var(--action)]"
              />
              Remove login
            </span>
            <span className="text-sm text-ink-soft">
              Deletes the login from this household. They&rsquo;d need a new invite to come back.
            </span>
            {target.memberId !== null && (
              <span className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={archive}
                  disabled={action !== "remove"}
                  onChange={(e) => {
                    setArchive(e.currentTarget.checked);
                  }}
                  aria-label={`Also stop planning meals for ${target.memberName ?? who} (archive, keeps history)`}
                  className="size-[18px] shrink-0 accent-[var(--action)]"
                />
                <span aria-hidden>
                  Also stop planning meals for {target.memberName ?? who} (archive, keeps history)
                </span>
              </span>
            )}
          </label>
        </div>
        <TextField
          label="Reason (only admins see this)"
          name="reason"
          placeholder="Optional"
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.currentTarget.value);
          }}
        />
        <p className="m-0 flex items-center gap-2.5 rounded-[12px] bg-flour px-3.5 py-3 text-sm text-ink">
          <Icon name="refresh" size={18} className="shrink-0" />
          {action === "block"
            ? "Recorded in the change log. Blocking can be undone there or here."
            : "Recorded in the change log, where it can be undone."}
        </p>
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
          <DangerButton busy={busy}>
            {action === "block" ? `Block ${who}` : `Remove ${who}`}
          </DangerButton>
        </div>
      </form>
    </Dialog>
  );
}
