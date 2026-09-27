// Form rows shared by this leaf's screens (UX-6: every control has a visible label, errors are
// announced, touch targets are at least 44 px). Styles follow the SignIn / CreateHousehold
// mockups: 48 px fields, 12 px radius, a 1.5 px line.
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "../ui/icon";

export const INPUT =
  "h-12 w-full min-w-0 rounded-[12px] border-[1.5px] border-line-strong bg-card px-3.5 text-base font-semibold text-ink placeholder:text-ink-muted placeholder:font-normal disabled:opacity-60";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  /** Shown under the field; announced with it. */
  readonly hint?: ReactNode;
  readonly error?: string | null;
  /** Visually hide the label (it stays the accessible name). */
  readonly hideLabel?: boolean;
  readonly mono?: boolean;
}

export function TextField({
  label,
  hint,
  error,
  hideLabel = false,
  mono = false,
  className = "",
  ...rest
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error ? errorId : null]
    .filter((v) => v !== null)
    .join(" ");
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-bold"}>
        {label}
      </label>
      <input
        id={id}
        className={`${INPUT} ${mono ? "font-mono font-medium tracking-wide" : ""}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        {...rest}
      />
      {hint !== undefined && (
        <span id={hintId} className="text-[13px] font-semibold text-ink-muted">
          {hint}
        </span>
      )}
      {error ? (
        <span id={errorId} className="text-[13px] font-bold text-pomegranate-text">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly hideLabel?: boolean;
  readonly children: ReactNode;
}

export function SelectField({
  label,
  hint,
  hideLabel = false,
  className = "",
  children,
  ...rest
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "text-sm font-bold"}>
        {label}
      </label>
      <select
        id={id}
        className={`${INPUT} px-3`}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        {...rest}
      >
        {children}
      </select>
      {hint !== undefined && (
        <span id={`${id}-hint`} className="text-[13px] font-semibold text-ink-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface ToggleRowProps {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/** A setting with a checkbox on the right (HouseholdSettings, AccountPhone notifications). */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  className = "",
}: ToggleRowProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 ${className}`}
    >
      <span className="flex flex-col">
        <span className="font-bold">{label}</span>
        {hint !== undefined && <span className="text-[13px] text-ink-muted">{hint}</span>}
      </span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.currentTarget.checked);
        }}
        className="size-[22px] shrink-0 accent-[var(--action)]"
      />
    </label>
  );
}

/** An error the person must see (UX-7): announced at once. */
export function FormError({ children }: { readonly children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <p
      role="alert"
      className="m-0 flex items-start gap-2 rounded-[12px] bg-pomegranate-tint px-3.5 py-3 text-sm font-bold text-pomegranate-text"
    >
      <Icon name="cross" size={18} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** A confirmation or neutral notice, announced politely. */
export function Notice({
  tone = "basil",
  children,
}: {
  readonly tone?: "basil" | "saffron" | "neutral";
  readonly children: ReactNode;
}) {
  if (children === null || children === undefined || children === "") return null;
  const cls =
    tone === "basil"
      ? "bg-basil-tint text-basil-text"
      : tone === "saffron"
        ? "bg-saffron-tint text-saffron-text"
        : "bg-flour text-ink";
  return (
    <p
      role="status"
      className={`m-0 flex items-start gap-2 rounded-[12px] px-3.5 py-3 text-sm font-bold ${cls}`}
    >
      {tone === "basil" && <Icon name="check" size={18} className="mt-px shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/** Upper-case section label ("SIGNED IN ON", "NOTIFICATIONS"). */
export function SectionLabel({
  children,
  as: Tag = "h2",
}: {
  readonly children: ReactNode;
  readonly as?: "h2" | "h3" | "span";
}) {
  return (
    <Tag className="m-0 font-body text-xs font-extrabold tracking-[0.08em] text-ink-muted uppercase">
      {children}
    </Tag>
  );
}
