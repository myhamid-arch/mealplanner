"use client";

import { useEffect, useMemo, useState, type SyntheticEvent, type ReactNode } from "react";
import type { z } from "zod";
import {
  accessList,
  changeSetsApply,
  householdDeletion,
  householdDeletionCancel,
  householdDeletionConfirm,
  householdDeletionRequest,
  householdExport,
  householdExportCsv,
  householdGet,
  supportGrantsCreate,
  supportGrantsList,
  supportGrantsRevoke,
  weightsGet,
  type DeletionDto,
  type HouseholdDto,
  type SupportGrantDto,
} from "@mealplanner/api-contract/contract";
import {
  DEFAULT_TOLERANCE,
  type AI_GENERATION_MODES,
  type INSIGHT_FREQUENCIES,
  type TOLERANCE_MODES,
} from "@mealplanner/core/types";
import { SETTINGS_TABS } from "../../../(shell)/_shell/nav";
import { api, problemMessage } from "../../../../components/admin/api";
import { DangerButton } from "../../../../components/admin/danger-button";
import {
  FormError,
  Notice,
  SelectField,
  TextField,
  ToggleRow,
} from "../../../../components/admin/field";
import { fullTime, plural } from "../../../../components/admin/format";
import { LoadError } from "../../../../components/admin/load-error";
import { useLoad } from "../../../../components/admin/use-load";
import { Button } from "../../../../components/ui/button";
import { Icon } from "../../../../components/ui/icon";
import { SegmentedControl } from "../../../../components/ui/segmented-control";
import { Dialog } from "../../../../components/ui/sheet";
import { SkeletonBlock } from "../../../../components/ui/skeleton";
import { TabLinks } from "../../../../components/ui/tab-links";

type Household = z.output<typeof HouseholdDto>;
type Deletion = z.output<typeof DeletionDto>;
type Grant = z.output<typeof SupportGrantDto>;
type AiMode = (typeof AI_GENERATION_MODES)[number];
type Frequency = (typeof INSIGHT_FREQUENCIES)[number];
type Precision = (typeof TOLERANCE_MODES)[number];

interface Data {
  household: Household;
  aiGeneration: AiMode;
  deletion: Deletion;
  grants: Grant[];
  adminCount: number;
}

/** The editable settings, as the form holds them. */
interface Form {
  name: string;
  regionNote: string;
  timezone: string;
  membersSeePlates: boolean;
  kitchenSeesNames: boolean;
  membersReviewForSiblings: boolean;
  agentMayApply: boolean;
  aiGeneration: AiMode;
  insightFrequency: Frequency;
  defaultPrecision: Precision;
  satFatDefaultPct: string;
}

const FREQUENCY_LABEL: Readonly<Record<Frequency, string>> = {
  nightly: "Nightly, plus after every 10 reviews",
  weekly: "Weekly",
  on_demand: "Only when I ask",
};

const AI_OPTIONS = [
  { value: "auto", label: "Add automatically" },
  { value: "ask", label: "Ask me first" },
  { value: "off", label: "Never" },
] as const;

function formOf(d: Data): Form {
  const h = d.household;
  return {
    name: h.name,
    regionNote: h.regionNote ?? "",
    timezone: h.timezone,
    membersSeePlates: h.membersSeePlates,
    kitchenSeesNames: h.kitchenSeesNames,
    membersReviewForSiblings: h.membersReviewForSiblings,
    agentMayApply: h.agentMayApply,
    aiGeneration: d.aiGeneration,
    insightFrequency: h.insightFrequency,
    defaultPrecision: h.defaultPrecision,
    satFatDefaultPct: String(h.satFatDefaultPct),
  };
}

function timeZones(current: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return all.includes(current) ? all : [current, ...all];
}

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function HouseholdSettingsScreen({ viewerUserId }: { readonly viewerUserId: string }) {
  const load = useLoad<Data>(async () => {
    const [household, weights, deletion, grants, access] = await Promise.all([
      api.call(householdGet, {}),
      api.call(weightsGet, {}),
      api.call(householdDeletion, {}),
      api.call(supportGrantsList, {}),
      api.call(accessList, {}),
    ]);
    return {
      household,
      aiGeneration: weights.aiGeneration,
      deletion,
      grants: grants.grants ?? [],
      adminCount: access.logins.filter((l) => l.role === "admin" && l.status === "active").length,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] lg:text-[34px]">Settings</h1>
        <TabLinks
          items={SETTINGS_TABS}
          activeHref="/settings/household"
          label="Settings sections"
        />
      </div>
      {load.status === "loading" ? (
        <SkeletonBlock label="Loading household settings" lines={8} />
      ) : load.status === "error" ? (
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      ) : (
        <Settings data={load.data} viewerUserId={viewerUserId} reload={load.reload} />
      )}
    </div>
  );
}

function Section({
  title,
  id,
  icon,
  children,
  className = "",
}: {
  readonly title: string;
  readonly id: string;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      className={`flex flex-col gap-3.5 rounded-[20px] bg-card p-5 shadow-card ${className}`}
    >
      <h2 id={id} className="flex items-center gap-2 text-[22px]">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Settings({
  data,
  viewerUserId,
  reload,
}: {
  readonly data: Data;
  readonly viewerUserId: string;
  readonly reload: () => Promise<void>;
}) {
  const initial = useMemo(() => formOf(data), [data]);
  const [form, setForm] = useState<Form>(initial);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setForm(initial);
  }, [initial]);
  const zones = useMemo(() => timeZones(initial.timezone), [initial.timezone]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus(null);
  };
  const dirty = (Object.keys(form) as (keyof Form)[]).filter((k) => form[k] !== initial[k]);

  async function save(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const sat = Number(form.satFatDefaultPct);
    if (form.name.trim() === "") {
      setError("The household needs a name.");
      return;
    }
    if (!Number.isFinite(sat) || sat <= 0 || sat > 100) {
      setError("The saturated fat cap is a percentage of calories between 0 and 100.");
      return;
    }
    const payload: Record<string, string | number | boolean | null> = {};
    for (const k of dirty) {
      if (k === "aiGeneration") continue;
      if (k === "satFatDefaultPct") payload[k] = sat;
      else if (k === "regionNote")
        payload[k] = form.regionNote.trim() === "" ? null : form.regionNote.trim();
      else if (k === "name") payload[k] = form.name.trim();
      else payload[k] = form[k];
    }
    const ops: { kind: string; payload: Record<string, string | number | boolean | null> }[] = [];
    if (Object.keys(payload).length > 0) ops.push({ kind: "household.update", payload });
    if (dirty.includes("aiGeneration"))
      ops.push({ kind: "weights.set", payload: { aiGeneration: form.aiGeneration } });
    if (ops.length === 0) return;
    setBusy(true);
    try {
      await api.call(changeSetsApply, { body: { summary: "Household settings", ops } });
      setStatus("Saved. The change log has an Undo.");
      await reload();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={(e) => {
          void save(e);
        }}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Section title="Household" id="s-household">
            <TextField
              label="Name"
              maxLength={120}
              value={form.name}
              onChange={(e) => {
                set("name", e.currentTarget.value);
              }}
            />
            <TextField
              label="Area — used to choose ingredients you can buy"
              maxLength={500}
              value={form.regionNote}
              onChange={(e) => {
                set("regionNote", e.currentTarget.value);
              }}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SelectField
                label="Time zone"
                value={form.timezone}
                onChange={(e) => {
                  set("timezone", e.currentTarget.value);
                }}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Units" value="metric" disabled hint="Metric only for now.">
                <option value="metric">Metric (kg, g, L, ml)</option>
              </SelectField>
            </div>
          </Section>

          <Section title="Who sees what" id="s-visibility">
            <ToggleRow
              label="Members see each other's plates and targets"
              hint="Off: members see only their own numbers."
              checked={form.membersSeePlates}
              onChange={(v) => {
                set("membersSeePlates", v);
              }}
            />
            <ToggleRow
              label="Kitchen sees names on the plating table"
              hint="Off: shows initials and colours only."
              checked={form.kitchenSeesNames}
              onChange={(v) => {
                set("kitchenSeesNames", v);
              }}
            />
            <ToggleRow
              label="Members can review for younger siblings"
              hint="Otherwise only admins can review on someone's behalf."
              checked={form.membersReviewForSiblings}
              onChange={(v) => {
                set("membersReviewForSiblings", v);
              }}
            />
          </Section>

          <Section
            title="Assistant & AI"
            id="s-assistant"
            icon={
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-[10px] bg-agent text-on-agent"
              >
                <Icon name="assistant" size={18} />
              </span>
            }
          >
            <ToggleRow
              label="Let the assistant apply changes I ask for"
              hint="Each one shows an Undo. Off: everything becomes a proposal."
              checked={form.agentMayApply}
              onChange={(v) => {
                set("agentMayApply", v);
              }}
            />
            <div className="flex flex-col gap-2">
              <span id="ai-recipes" className="font-bold">
                New recipes when the library runs short
              </span>
              <SegmentedControl
                label="New recipes when the library runs short"
                options={AI_OPTIONS}
                value={form.aiGeneration}
                onValueChange={(v) => {
                  set("aiGeneration", v);
                }}
                className="max-w-full flex-wrap"
              />
            </div>
            <SelectField
              label="Insight check-ins"
              value={form.insightFrequency}
              onChange={(e) => {
                set("insightFrequency", e.currentTarget.value as Frequency);
              }}
            >
              {(Object.keys(FREQUENCY_LABEL) as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </SelectField>
          </Section>

          <Section title="Default precision" id="s-precision">
            <p className="m-0 text-sm text-ink-soft">
              Per meal, for everyone with targets. Each person can override on their profile.
            </p>
            <dl className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4">
              {(
                [
                  ["Protein", `±${String(DEFAULT_TOLERANCE.proteinG)} g`],
                  ["Carbs", `±${String(DEFAULT_TOLERANCE.carbsG)} g`],
                  ["Fat", `±${String(DEFAULT_TOLERANCE.fatG)} g`],
                  ["Calories", `±${String(DEFAULT_TOLERANCE.kcal)} a day`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex flex-col rounded-[12px] bg-flour px-3 py-2">
                  <dt className="text-[13px] font-bold text-ink-muted">{k}</dt>
                  <dd className="m-0 tabular text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-2">
              <span className="font-bold">When a meal can&rsquo;t hit its targets</span>
              <SegmentedControl
                label="When a meal can't hit its targets"
                options={[
                  { value: "strict", label: "Strict: flag it" },
                  { value: "flexible", label: "Flexible: closest plate" },
                ]}
                value={form.defaultPrecision}
                onValueChange={(v) => {
                  set("defaultPrecision", v);
                }}
                className="max-w-full flex-wrap"
              />
            </div>
            <TextField
              label="Saturated fat cap when not set (% of calories)"
              inputMode="decimal"
              value={form.satFatDefaultPct}
              onChange={(e) => {
                set("satFatDefaultPct", e.currentTarget.value);
              }}
              className="max-w-[320px]"
            />
          </Section>
        </div>
        <FormError>{error}</FormError>
        <Notice>{status}</Notice>
        <div className="sticky bottom-[calc(96px+env(safe-area-inset-bottom))] z-10 flex items-center justify-end gap-3 rounded-[16px] bg-card p-3 shadow-raised lg:bottom-4">
          <span className="grow text-sm text-ink-soft" aria-live="polite">
            {dirty.length === 0
              ? "All changes saved."
              : `${plural(dirty.length, "unsaved change", "unsaved changes")}.`}
          </span>
          {dirty.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                setForm(initial);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="submit" loading={busy} disabled={dirty.length === 0}>
            Save changes
          </Button>
        </div>
      </form>

      <ExportSection />
      <SupportSection grants={data.grants} reload={reload} />
      <DeleteSection
        deletion={data.deletion}
        adminCount={data.adminCount}
        viewerUserId={viewerUserId}
        reload={reload}
      />
    </div>
  );
}

function ActionSection({
  id,
  title,
  text,
  children,
  extra,
}: {
  readonly id: string;
  readonly title: string;
  readonly text: ReactNode;
  readonly children: ReactNode;
  readonly extra?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-[20px] bg-card p-5 shadow-card"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-[22px]">
            {title}
          </h2>
          <span className="text-sm text-ink-soft">{text}</span>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">{children}</div>
      </div>
      {extra}
    </section>
  );
}

/** R2-ADM-6 data export: every household table as JSON, and each as CSV. */
function ExportSection() {
  const [tables, setTables] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function json() {
    setError(null);
    setBusy("json");
    try {
      const data = await api.call(householdExport, {});
      download(
        `household-${data.exportedAt.slice(0, 10)}.json`,
        "application/json",
        JSON.stringify(data, null, 2),
      );
      setTables(Object.keys(data.tables).sort());
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }
  async function csv(table: string) {
    setError(null);
    setBusy(table);
    try {
      // The CSV endpoint has no JSON body to parse, so read it raw (same auth and errors).
      const res = await api.raw(householdExportCsv, { params: { table } });
      download(`${table}.csv`, "text/csv", await res.text());
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <ActionSection
      id="s-data"
      title="Your data"
      text="Download everything: people, targets, recipes, plans, reviews, change log."
      extra={
        <>
          <FormError>{error}</FormError>
          {tables !== null && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">JSON downloaded. Each table as CSV:</span>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {tables.map((t) => (
                  <li key={t}>
                    <Button
                      variant="secondary"
                      loading={busy === t}
                      onClick={() => {
                        void csv(t);
                      }}
                    >
                      {t}.csv
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      }
    >
      <Button
        variant="secondary"
        loading={busy === "json"}
        onClick={() => {
          void json();
        }}
      >
        Export (JSON + CSV)
      </Button>
    </ActionSection>
  );
}

/** R2-ADM-8: time-limited support access for a platform operator (leaf-1.4.6 SPEC-Q-10). */
function SupportSection({
  grants,
  reload,
}: {
  readonly grants: readonly Grant[];
  readonly reload: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [hours, setHours] = useState("24");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const active = grants.filter((g) => g.active);

  async function grant(e: SyntheticEvent) {
    e.preventDefault();
    setError(null);
    const h = Number(hours);
    if (!Number.isInteger(h) || h < 1 || h > 168) {
      setError("Support access lasts 1 to 168 hours (7 days).");
      return;
    }
    setBusy("grant");
    try {
      await api.call(supportGrantsCreate, { body: { operatorEmail: email.trim(), hours: h } });
      setEmail("");
      await reload();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="s-support"
      className="flex flex-col gap-3 rounded-[20px] bg-card p-5 shadow-card"
    >
      <h2 id="s-support" className="text-[22px]">
        Support access
      </h2>
      <p className="m-0 text-sm text-ink-soft">
        Whoever runs this site can&rsquo;t see your household&rsquo;s data unless an admin grants
        time-limited access here. Every view they make is logged in the change log.
      </p>
      {active.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {active.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center gap-3 rounded-[12px] bg-flour px-3.5 py-2"
            >
              <span className="grow text-sm">
                <strong>{g.operatorEmail}</strong> until {fullTime(g.expiresAt)}
              </span>
              <Button
                variant="secondary"
                loading={busy === g.id}
                onClick={() => {
                  setBusy(g.id);
                  void api
                    .call(supportGrantsRevoke, { params: { id: g.id } })
                    .then(reload)
                    .catch((err: unknown) => {
                      setError(problemMessage(err));
                    })
                    .finally(() => {
                      setBusy(null);
                    });
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          void grant(e);
        }}
        className="flex flex-col gap-3 md:flex-row md:items-end"
        noValidate
      >
        <TextField
          label="Operator's email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.currentTarget.value);
          }}
          className="grow"
        />
        <TextField
          label="For how many hours"
          inputMode="numeric"
          value={hours}
          onChange={(e) => {
            setHours(e.currentTarget.value);
          }}
          className="md:w-[180px]"
        />
        <Button
          type="submit"
          variant="secondary"
          loading={busy === "grant"}
          disabled={email.trim() === ""}
          className="h-12"
        >
          Grant access
        </Button>
      </form>
      <FormError>{error}</FormError>
    </section>
  );
}

/** R2-ADM-6: a 14-day grace any admin can cancel; a second admin confirms when there is one. */
function DeleteSection({
  deletion,
  adminCount,
  viewerUserId,
  reload,
}: {
  readonly deletion: Deletion;
  readonly adminCount: number;
  readonly viewerUserId: string;
  readonly reload: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setError(null);
    setBusy(key);
    try {
      await fn();
      setConfirming(false);
      await reload();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const requested = deletion.requestedAt !== null;
  let text: ReactNode =
    "Removes all data after 14 days. Any admin can cancel during that time. Needs confirmation from a second admin if there is one.";
  if (requested && deletion.awaitingSecondAdmin)
    text =
      deletion.requestedByUserId === viewerUserId
        ? "You asked to delete this household. Another admin must confirm before the 14 days start."
        : "Another admin asked to delete this household. Confirm to start the 14 days, or cancel.";
  else if (requested && deletion.purgeAfter !== null)
    text = `This household and all its data will be deleted after ${fullTime(deletion.purgeAfter)}. Any admin can cancel until then.`;

  return (
    <ActionSection
      id="s-delete"
      title="Delete household"
      text={<span data-testid="deletion-state">{text}</span>}
      extra={<FormError>{error}</FormError>}
    >
      {!requested ? (
        <Button
          variant="danger"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete household…
        </Button>
      ) : (
        <>
          {deletion.awaitingSecondAdmin && deletion.requestedByUserId !== viewerUserId && (
            <DangerButton
              type="button"
              busy={busy === "confirm"}
              onClick={() => {
                void act("confirm", () => api.call(householdDeletionConfirm, {}));
              }}
            >
              Confirm deletion
            </DangerButton>
          )}
          <Button
            variant="secondary"
            loading={busy === "cancel"}
            onClick={() => {
              void act("cancel", () => api.call(householdDeletionCancel, {}));
            }}
          >
            Cancel deletion
          </Button>
        </>
      )}
      {confirming && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setConfirming(false);
          }}
          title="Delete this household?"
          description={
            adminCount > 1
              ? "Another admin must confirm. Then everything is deleted after 14 days unless an admin cancels."
              : "Everything is deleted after 14 days unless an admin cancels."
          }
          width={560}
        >
          <FormError>{error}</FormError>
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep household
            </Button>
            <DangerButton
              type="button"
              busy={busy === "request"}
              onClick={() => {
                void act("request", () => api.call(householdDeletionRequest, {}));
              }}
            >
              {adminCount > 1 ? "Ask to delete" : "Delete in 14 days"}
            </DangerButton>
          </div>
        </Dialog>
      )}
    </ActionSection>
  );
}
