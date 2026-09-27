"use client";

import { useState, type SyntheticEvent, type ReactNode } from "react";
import type { z } from "zod";
import { ApiProblem } from "@mealplanner/api-contract/client";
import {
  platformAiUsage,
  platformBlock,
  platformDelete,
  platformFailedJobs,
  platformHouseholds,
  platformReactivate,
  platformSuspend,
  platformUnblock,
  platformUsers,
  supportSummary,
  type AiUsageDto,
  type PlatformHouseholdDto,
  type PlatformJobDto,
  type PlatformUserDto,
  type SupportSummaryDto,
} from "@mealplanner/api-contract/contract";
import { api, problemMessage } from "../../../components/admin/api";
import { signOut } from "../../../components/admin/auth-client";
import { FormError, Notice, TextField } from "../../../components/admin/field";
import { fullTime, logTime, ROLE_LABEL, thousands, usd } from "../../../components/admin/format";
import { LoadError } from "../../../components/admin/load-error";
import { useLoad } from "../../../components/admin/use-load";
import { Button } from "../../../components/ui/button";
import { Dialog } from "../../../components/ui/sheet";
import { SkeletonBlock } from "../../../components/ui/skeleton";

type HouseholdRow = z.output<typeof PlatformHouseholdDto>;
type UserRow = z.output<typeof PlatformUserDto>;
type Usage = z.output<typeof AiUsageDto>;
type Job = z.output<typeof PlatformJobDto>;
type Summary = z.output<typeof SupportSummaryDto>;

const TABS = [
  { key: "households", label: "Households" },
  { key: "users", label: "Users" },
  { key: "ai", label: "AI usage" },
  { key: "system", label: "System" },
] as const;
type Tab = (typeof TABS)[number]["key"];

interface Data {
  households: HouseholdRow[];
  usage: Usage;
  jobs: Job[];
}

const STATUS: Readonly<Record<HouseholdRow["status"], { label: string; cls: string }>> = {
  active: { label: "Active", cls: "bg-basil-tint text-basil-text" },
  suspended: { label: "Suspended", cls: "bg-pomegranate-tint text-pomegranate-text" },
  deletion_pending: { label: "Deleting", cls: "bg-saffron-tint text-saffron-text" },
};

const TH = "px-4 py-3 text-left text-xs font-extrabold tracking-[0.06em] text-ink-muted uppercase";
const TD = "px-4 py-3 align-middle";

function Table({
  caption,
  head,
  children,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-[20px] bg-card shadow-card">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-flour">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${String(i)}`} scope="col" className={TH}>
                {h === "" ? <span className="sr-only">Actions</span> : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function errorText(error: unknown): string {
  if (error === null || error === undefined) return "No reason recorded";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return JSON.stringify(error);
}

export function ConsoleScreen() {
  const [tab, setTab] = useState<Tab>("households");
  const load = useLoad<Data>(async () => {
    const [households, usage, jobs] = await Promise.all([
      api.call(platformHouseholds, {}),
      api.call(platformAiUsage, { query: { days: 30 } }),
      api.call(platformFailedJobs, { query: { hours: 24 } }),
    ]);
    return { households: households.households ?? [], usage, jobs: jobs.jobs ?? [] };
  });

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 bg-rail px-4 py-3 text-rail-ink lg:px-9">
        <span className="flex items-center gap-3 text-rail-ink-strong">
          <span className="font-display text-[22px] font-bold">Mise</span>
          <span className="rounded-full bg-rail-active px-2.5 py-1 text-xs font-extrabold tracking-[0.08em] text-on-rail-active">
            PLATFORM OPERATOR
          </span>
        </span>
        <div
          role="tablist"
          aria-label="Console"
          className="flex flex-wrap gap-1"
          data-surface="rail"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              onClick={() => {
                setTab(t.key);
              }}
              className="min-h-11 rounded-md px-3.5 font-bold text-rail-ink hover:bg-rail-raised aria-selected:bg-rail-active aria-selected:text-on-rail-active"
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="grow text-right text-[13px] text-rail-ink max-lg:hidden">
          Only for whoever runs the site for several families
        </span>
        <button
          type="button"
          className="min-h-11 rounded-md px-3 font-bold text-rail-ink-strong hover:bg-rail-raised"
          data-surface="rail"
          onClick={() => {
            void signOut().finally(() => {
              window.location.assign("/sign-in?notice=signed-out");
            });
          }}
        >
          Sign out
        </button>
      </header>
      <main id="main" className="mx-auto flex max-w-[1200px] flex-col gap-5 px-4 py-7 lg:px-9">
        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="flex flex-col gap-5"
        >
          {load.status === "loading" ? (
            <SkeletonBlock label="Loading the console" lines={8} />
          ) : load.status === "error" ? (
            <LoadError message={load.message} onRetry={() => void load.reload()} />
          ) : tab === "households" ? (
            <HouseholdsPanel data={load.data} reload={load.reload} />
          ) : tab === "users" ? (
            <UsersPanel />
          ) : tab === "ai" ? (
            <UsagePanel usage={load.data.usage} />
          ) : (
            <JobsPanel jobs={load.data.jobs} />
          )}
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[18px] bg-card p-4 shadow-card">
      <span className="text-[13px] font-bold text-ink-muted">{label}</span>
      <span className="font-display text-[30px] font-bold">{value}</span>
    </div>
  );
}

function HouseholdsPanel({
  data,
  reload,
}: {
  readonly data: Data;
  readonly reload: () => Promise<void>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState<HouseholdRow | null>(null);
  const [deleting, setDeleting] = useState<HouseholdRow | null>(null);

  async function act(key: string, fn: () => Promise<string>) {
    setError(null);
    setStatus(null);
    setBusy(key);
    try {
      setStatus(await fn());
      await reload();
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const logins = data.households.reduce((n, h) => n + h.logins, 0);
  return (
    <>
      <h1 className="text-[28px] lg:text-[34px]">Households</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Households" value={thousands(data.households.length)} />
        <Stat label="Logins" value={thousands(logins)} />
        <Stat label="AI cost (30 days)" value={usd(data.usage.totalCostUsd)} />
        <Stat label="Failed jobs (24 h)" value={thousands(data.jobs.length)} />
      </div>
      <Notice>{status}</Notice>
      <FormError>{error}</FormError>
      {data.households.length === 0 ? (
        <p className="m-0 text-ink-soft">No households yet.</p>
      ) : (
        <Table
          caption="Households"
          head={["Household", "Admins", "Logins", "Plans (30 d)", "AI calls (30 d)", "Status", ""]}
        >
          {data.households.map((h) => (
            <tr key={h.id} className="border-t border-flour" data-testid={`household-${h.id}`}>
              <td className={`${TD} font-extrabold`}>{h.name}</td>
              <td className={`${TD} tabular`}>{h.admins}</td>
              <td className={`${TD} tabular`}>{h.logins}</td>
              <td className={`${TD} tabular`}>{h.plans30d}</td>
              <td className={`${TD} tabular`}>{thousands(h.aiCalls30d)}</td>
              <td className={TD}>
                <span
                  className={`rounded-full px-2.5 py-1 text-[13px] font-extrabold ${STATUS[h.status].cls}`}
                >
                  {STATUS[h.status].label}
                </span>
              </td>
              <td className={TD}>
                <span className="flex justify-end gap-4 font-extrabold">
                  {h.status === "active" ? (
                    <>
                      <button
                        type="button"
                        className="min-h-11 text-action"
                        onClick={() => {
                          setDetails(h);
                        }}
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        className="min-h-11 text-pomegranate-text"
                        disabled={busy === h.id}
                        onClick={() => {
                          void act(h.id, async () => {
                            await api.call(platformSuspend, { params: { id: h.id } });
                            return `${h.name} is suspended. Its logins can't use it until reactivated.`;
                          });
                        }}
                      >
                        Suspend
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="min-h-11 text-action"
                        disabled={busy === h.id}
                        onClick={() => {
                          void act(h.id, async () => {
                            await api.call(platformReactivate, { params: { id: h.id } });
                            return `${h.name} is active again.`;
                          });
                        }}
                      >
                        Reactivate
                      </button>
                      {h.status === "suspended" && (
                        <button
                          type="button"
                          className="min-h-11 text-pomegranate-text"
                          onClick={() => {
                            setDeleting(h);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="support-note"
          className="flex flex-col gap-2 rounded-[20px] bg-card p-5 shadow-card"
        >
          <h2 id="support-note" className="text-[20px]">
            Support access
          </h2>
          <p className="m-0 text-sm text-ink-soft">
            Operators can&rsquo;t see a household&rsquo;s data unless one of its admins grants
            time-limited access from their Settings. Every view is logged in that household&rsquo;s
            change log.
          </p>
        </section>
      </div>
      {details !== null && (
        <DetailsDialog
          household={details}
          onClose={() => {
            setDetails(null);
          }}
        />
      )}
      {deleting !== null && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          title={`Delete ${deleting.name}?`}
          description="Starts the 14-day grace period; the household's admins can still cancel it."
          width={560}
        >
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setDeleting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === `del-${deleting.id}`}
              onClick={() => {
                const h = deleting;
                void act(`del-${h.id}`, async () => {
                  await api.call(platformDelete, { params: { id: h.id } });
                  setDeleting(null);
                  return `${h.name} will be deleted in 14 days unless its admins cancel.`;
                });
              }}
            >
              Delete in 14 days
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** A household's support summary, only while one of its admins has granted access. */
function DetailsDialog({
  household,
  onClose,
}: {
  readonly household: HouseholdRow;
  readonly onClose: () => void;
}) {
  const load = useLoad<Summary | { denied: string }>(async () => {
    try {
      return await api.call(supportSummary, { params: { id: household.id } });
    } catch (err) {
      if (err instanceof ApiProblem && err.status === 403) return { denied: problemMessage(err) };
      throw err;
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={household.name}
      width={560}
    >
      {load.status === "loading" ? (
        <SkeletonBlock label="Loading details" lines={4} />
      ) : load.status === "error" ? (
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      ) : "denied" in load.data ? (
        <Notice tone="neutral">{load.data.denied}</Notice>
      ) : (
        <dl className="m-0 grid grid-cols-2 gap-3">
          {(
            [
              ["Members", load.data.members],
              ["Logins", load.data.logins],
              ["Plan days", load.data.planDays],
              ["Pending proposals", load.data.pendingProposals],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-[12px] bg-flour px-3 py-2">
              <dt className="text-[13px] font-bold text-ink-muted">{k}</dt>
              <dd className="m-0 tabular">{v}</dd>
            </div>
          ))}
          <div className="col-span-2 text-sm text-ink-soft">
            Time zone {load.data.household.timezone} · created{" "}
            {fullTime(load.data.household.createdAt)}. This view is recorded in the
            household&rsquo;s change log.
          </div>
        </dl>
      )}
    </Dialog>
  );
}

function UsersPanel() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function search(e?: SyntheticEvent) {
    e?.preventDefault();
    setError(null);
    if (query.trim().length < 2) {
      setError("Type at least 2 characters of a name or email.");
      return;
    }
    setBusy("search");
    try {
      setUsers((await api.call(platformUsers, { query: { q: query.trim() } })).users ?? []);
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="text-[28px] lg:text-[34px]">Find a user</h1>
      <form
        onSubmit={(e) => {
          void search(e);
        }}
        className="flex flex-col gap-3 md:flex-row md:items-end"
        noValidate
      >
        <TextField
          label="Name or email"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
          }}
          className="grow"
        />
        <Button type="submit" loading={busy === "search"} className="h-12">
          Search
        </Button>
      </form>
      <FormError>{error}</FormError>
      {users !== null &&
        (users.length === 0 ? (
          <p className="m-0 text-ink-soft">Nobody matches.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 rounded-[16px] bg-card px-4 py-3 shadow-card"
              >
                <span className="flex min-w-0 grow flex-col">
                  <span className="font-extrabold">
                    {u.email}
                    {u.platformBlocked && (
                      <span className="ml-2 rounded-full bg-pomegranate-tint px-2 py-0.5 text-xs font-extrabold text-pomegranate-text">
                        Blocked on the platform
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {u.name}
                    {u.memberships.length === 0
                      ? " · no household"
                      : ` · ${u.memberships
                          .map(
                            (m) =>
                              `${ROLE_LABEL[m.role]} in ${m.householdName}${m.status === "blocked" ? " (blocked there by its admin)" : ""}`,
                          )
                          .join(" · ")}`}
                  </span>
                </span>
                <Button
                  variant={u.platformBlocked ? "secondary" : "danger"}
                  loading={busy === u.id}
                  onClick={() => {
                    setBusy(u.id);
                    setError(null);
                    void (
                      u.platformBlocked
                        ? api.call(platformUnblock, { params: { id: u.id } })
                        : api.call(platformBlock, { params: { id: u.id } })
                    )
                      .then((next) => {
                        setUsers((list) => (list ?? []).map((x) => (x.id === next.id ? next : x)));
                      })
                      .catch((err: unknown) => {
                        setError(problemMessage(err));
                      })
                      .finally(() => {
                        setBusy(null);
                      });
                  }}
                >
                  {u.platformBlocked ? "Unblock on whole platform" : "Block on whole platform"}
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </>
  );
}

const PURPOSE: Readonly<Record<string, string>> = {
  recipe: "Recipes",
  insights: "Insights",
  chat: "Assistant",
  comment_extraction: "Review tags",
};

function UsagePanel({ usage }: { readonly usage: Usage }) {
  return (
    <>
      <h1 className="text-[28px] lg:text-[34px]">AI usage</h1>
      <p className="m-0 text-ink-soft">
        {logTime(usage.from)} to {logTime(usage.to)} · total {usd(usage.totalCostUsd)}. Cost uses
        the price table; a model it does not list shows tokens only.
      </p>
      {usage.rows.length === 0 ? (
        <p className="m-0 text-ink-soft">No AI calls in this period.</p>
      ) : (
        <Table
          caption="AI usage by model and purpose"
          head={["Model", "For", "Calls", "Input", "Output", "Cache hits", "Cost"]}
        >
          {usage.rows.map((r) => (
            <tr key={`${r.model}-${r.purpose}`} className="border-t border-flour">
              <td className={`${TD} font-mono`}>{r.model}</td>
              <td className={TD}>{PURPOSE[r.purpose] ?? r.purpose}</td>
              <td className={`${TD} tabular`}>{thousands(r.calls)}</td>
              <td className={`${TD} tabular`}>{thousands(r.inputTokens)}</td>
              <td className={`${TD} tabular`}>{thousands(r.outputTokens)}</td>
              <td className={`${TD} tabular`}>{thousands(r.cacheReadTokens)}</td>
              <td className={`${TD} tabular`}>{r.costUsd === null ? "—" : usd(r.costUsd)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function JobsPanel({ jobs }: { readonly jobs: readonly Job[] }) {
  return (
    <>
      <h1 className="text-[28px] lg:text-[34px]">Failed jobs</h1>
      <p className="m-0 text-ink-soft">The last 24 hours, every household and platform job.</p>
      {jobs.length === 0 ? (
        <p className="m-0 text-ink-soft">No failed jobs.</p>
      ) : (
        <Table caption="Failed jobs" head={["Failed", "Job", "Household", "Reason"]}>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-flour">
              <td className={TD}>{j.finishedAt === null ? "—" : logTime(j.finishedAt)}</td>
              <td className={`${TD} font-mono`}>{j.kind}</td>
              <td className={`${TD} font-mono text-xs`}>{j.householdId ?? "platform"}</td>
              <td className={`${TD} max-w-[460px] break-words`}>{errorText(j.error)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
