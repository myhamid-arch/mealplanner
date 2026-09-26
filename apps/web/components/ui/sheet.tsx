"use client";

import { Dialog as RadixDialog } from "radix-ui";
import type { ReactNode } from "react";
import { Icon } from "./icon";

export interface SheetProps {
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly defaultOpen?: boolean;
  /** Element that opens the sheet (rendered with Radix `asChild`, so pass a button or link). */
  readonly trigger?: ReactNode;
  /** Required: the dialog's accessible name and visible heading. */
  readonly title: string;
  readonly description?: string;
  /**
   * Desktop form: `side` is the right-hand sheet (SwapDialog.dc.html), `center` the centred
   * dialog (BlockDialog.dc.html). On phones both are bottom sheets (QuickRatePhone.dc.html).
   */
  readonly desktop?: "side" | "center";
  /** Desktop width in px (centre dialogs; side sheets are 640). */
  readonly width?: number;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

const PANEL: Record<NonNullable<SheetProps["desktop"]>, string> = {
  side: "lg:inset-y-0 lg:right-0 lg:bottom-auto lg:left-auto lg:h-dvh lg:max-h-none lg:w-[640px] lg:max-w-full lg:rounded-none lg:p-7",
  center:
    "lg:top-1/2 lg:right-auto lg:bottom-auto lg:left-1/2 lg:max-h-[90dvh] lg:-translate-x-1/2 lg:w-[min(var(--dialog-width),calc(100vw-32px))] lg:-translate-y-1/2 lg:rounded-[26px] lg:p-8",
};

export type SheetPanelProps = Pick<
  SheetProps,
  "title" | "description" | "desktop" | "width" | "children" | "footer"
>;

/**
 * The sheet's panel: title, close button, body and footer. Must sit inside a Radix
 * `Dialog.Root`; `Sheet` puts it in a portal over an overlay. Exported for callers that need
 * their own root or portal container.
 */
export function SheetPanel({
  title,
  description,
  desktop = "side",
  width = 560,
  children,
  footer,
}: SheetPanelProps) {
  return (
    <RadixDialog.Content
      {...(description === undefined ? { "aria-describedby": undefined } : {})}
      className={`sheet-enter fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-paper px-[18px] pt-[22px] pb-[max(30px,env(safe-area-inset-bottom))] text-ink shadow-sheet ${PANEL[desktop]}`}
      style={
        desktop === "center" ? { ["--dialog-width" as string]: `${String(width)}px` } : undefined
      }
    >
      <span
        aria-hidden
        className="h-[5px] w-11 self-center rounded-[3px] bg-line-strong lg:hidden"
      />
      <div className="flex items-start gap-3">
        <div className="flex grow flex-col gap-1">
          <RadixDialog.Title className="font-display text-[22px] font-bold">
            {title}
          </RadixDialog.Title>
          {description !== undefined && (
            <RadixDialog.Description className="m-0 text-sm text-ink-muted">
              {description}
            </RadixDialog.Description>
          )}
        </div>
        <RadixDialog.Close
          aria-label="Close"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-flour text-ink hover:bg-line-strong"
        >
          <Icon name="close" />
        </RadixDialog.Close>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      {footer !== undefined && <div className="flex flex-wrap justify-end gap-3">{footer}</div>}
    </RadixDialog.Content>
  );
}

/**
 * Sheet / dialog (UX-3 phones, UX-6): Radix Dialog, so focus is trapped and restored, Escape
 * closes, the page behind is inert, and the title names the dialog.
 */
export function Sheet({ open, onOpenChange, defaultOpen, trigger, ...panel }: SheetProps) {
  return (
    <RadixDialog.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
    >
      {trigger !== undefined && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fade-enter fixed inset-0 z-40 bg-[color-mix(in_srgb,var(--rail)_55%,transparent)]" />
        <SheetPanel {...panel} />
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Centred dialog on desktop, bottom sheet on phones. */
export function Dialog(props: Omit<SheetProps, "desktop">) {
  return <Sheet {...props} desktop="center" />;
}
