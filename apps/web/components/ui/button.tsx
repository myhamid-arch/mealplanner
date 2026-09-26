import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const BASE =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md font-extrabold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-action text-on-action hover:bg-action-hover hover:text-on-action",
  secondary: "bg-flour text-ink hover:bg-line-strong hover:text-ink",
  ghost: "bg-transparent text-action hover:bg-tomato-tint hover:text-tomato-text",
  danger: "bg-pomegranate-tint text-pomegranate-text hover:bg-pomegranate-tint hover:underline",
};

const SIZE: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-[15px]",
  lg: "px-5 py-3.5 text-base",
};

/** Class names shared by Button and LinkButton, for other leaves' custom controls. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra = "",
): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

function Content({ icon, children }: { readonly icon?: IconName; readonly children: ReactNode }) {
  return (
    <>
      {icon !== undefined && <Icon name={icon} size={18} />}
      {children}
    </>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
  /** Shows a busy state and blocks repeat presses. */
  readonly loading?: boolean;
}

/** Button (UX-5/UX-6): ≥ 44 px target, visible focus, a loading state. */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
        />
      ) : null}
      <Content {...(loading || icon === undefined ? {} : { icon })}>{children}</Content>
    </button>
  );
}

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: IconName;
}

/** A navigation that looks like a button ("Plan it", "Ask the assistant"). */
export function LinkButton({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      <Content {...(icon === undefined ? {} : { icon })}>{children}</Content>
    </Link>
  );
}
