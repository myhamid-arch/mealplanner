"use client";

import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

export interface MenuAction {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  /** Draws a divider above this item. */
  readonly separated?: boolean;
  readonly disabled?: boolean;
}

/**
 * The "More actions" menu of a login (PeopleAccess.dc.html): Radix DropdownMenu, so it opens
 * with Enter/Space/arrow keys, moves with arrows, closes on Escape and returns focus (UX-6).
 */
export function ActionsMenu({
  label,
  actions,
}: {
  /** Accessible name of the trigger, e.g. "More actions for Layla". */
  readonly label: string;
  readonly actions: readonly MenuAction[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className="flex size-11 items-center justify-center rounded-[10px] text-ink hover:bg-flour data-[state=open]:border-2 data-[state=open]:border-action data-[state=open]:bg-tomato-tint"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="fade-enter z-50 flex w-[270px] flex-col rounded-2xl bg-card p-2 text-ink shadow-sheet"
        >
          {actions.map((a) => (
            <MenuItem key={a.label} action={a} />
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({ action }: { readonly action: MenuAction }): ReactNode {
  return (
    <>
      {action.separated === true && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
      <DropdownMenu.Item
        disabled={action.disabled}
        onSelect={action.onSelect}
        className={`flex min-h-11 cursor-pointer items-center rounded-[10px] px-3 outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60 data-[highlighted]:bg-flour ${
          action.danger === true ? "font-extrabold text-pomegranate-text" : "font-bold"
        }`}
      >
        {action.label}
      </DropdownMenu.Item>
    </>
  );
}
