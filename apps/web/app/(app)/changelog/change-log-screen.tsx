"use client";

import { useState } from "react";
import type { z } from "zod";
import {
  accessList,
  changeSetsList,
  changeSetsUndo,
  type ChangeLogEntryDto,
} from "@mealplanner/api-contract/contract";
import { SETTINGS_TABS } from "../../(shell)/_shell/nav";
import { ActorBadge, type ActorKind } from "../../../components/admin/actor-badge";
import { api, problemMessage } from "../../../components/admin/api";
import { FormError, Notice } from "../../../components/admin/field";
import { fullTime, logTime } from "../../../components/admin/format";
import { LoadError } from "../../../components/admin/load-error";
import { useLoad } from "../../../components/admin/use-load";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { SkeletonBlock } from "../../../components/ui/skeleton";
import { TabLinks } from "../../../components/ui/tab-links";

type Entry = z.output<typeof ChangeLogEntryDto>;

/**
 * The filters of ChangeLog.dc.html (leaf-1.4.6 SPEC-Q-11): areas are filtered by the API;
 * "Learned automatically" is the changes the system made on its own (`source = learning`).
 */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "access", label: "People & access" },
  { key: "targets", label: "Targets" },
  { key: "recipes", label: "Recipes" },
  { key: "plans", label: "Plans" },
  { key: "learned", label: "Learned automatically" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

interface Data {
  entries: Entry[];
  names: Map<string, string>;
}

function actorOf(
  entry: Entry,
  names: Map<string, string>,
  viewerUserId: string,
): {
  kind: ActorKind;
  label: string;
} {
  if (entry.type === "support_view")
    return { kind: "support", label: `Support view · ${entry.operatorEmail}` };
  const name =
    entry.actorUserId === null
      ? null
      : entry.actorUserId === viewerUserId
        ? "you"
        : (names.get(entry.actorUserId) ?? "a former login");
  switch (entry.source) {
    case "agent_apply":
      return {
        kind: "assistant",
        label:
          name === null || name === "you" ? "Assistant · you asked" : `Assistant · ${name} asked`,
      };
    case "proposal_accept":
      return {
        kind: "proposal",
        label: `Proposal accepted by ${name === "you" ? "you" : (name ?? "an admin")}`,
      };
    case "learning":
      return { kind: "learned", label: "Learned automatically" };
    default:
      return {
        kind: "user",
        label: name === null ? "System" : name === "you" ? "You" : name,
      };
  }
}

/** W-14: the entry's resolved title, or its stored summary when it does not resolve. */
function titleOf(entry: Entry & { type: "change_set" }): string {
  return entry.detail?.title ?? entry.summary;
}

type Change = NonNullable<(Entry & { type: "change_set" })["detail"]>["changes"][number];

/**
 * ChangeLog.dc.html's before → after chips: the old values struck through, then the new ones.
 * Each value carries its label ("protein 130 g", not "P 130") so it reads on its own (a11y).
 */
function Chips({ changes }: { readonly changes: readonly Change[] }) {
  const side = (pick: (c: Change) => string | null) =>
    changes
      .flatMap((c) => {
        const v = pick(c);
        return v === null ? [] : [`${c.label} ${v}`];
      })
      .join(" · ");
  const before = side((c) => c.before);
  const after = side((c) => c.after);
  return (
    <span className="flex flex-wrap items-center gap-2.5 font-mono text-[13px]">
      {before !== "" && (
        <span className="rounded-lg bg-pomegranate-tint px-2.5 py-1.5 text-pomegranate-text">
          <span className="sr-only">Before: </span>
          <del>{before}</del>
        </span>
      )}
      {after !== "" && (
        <span className="rounded-lg bg-basil-tint px-2.5 py-1.5 text-basil-text">
          <span className="sr-only">After: </span>
          {after}
        </span>
      )}
    </span>
  );
}

export function ChangeLogScreen({ viewerUserId }: { readonly viewerUserId: string }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const load = useLoad<Data>(async () => {
    const area = filter === "all" || filter === "learned" ? undefined : filter;
    const [log, access] = await Promise.all([
      api.call(changeSetsList, {
        query: { limit: filter === "learned" ? 200 : 100, ...(area === undefined ? {} : { area }) },
      }),
      api.call(accessList, {}),
    ]);
    const names = new Map(access.logins.map((l) => [l.userId, l.name]));
    const entries = (log.entries ?? []).filter(
      (e) => filter !== "learned" || (e.type === "change_set" && e.source === "learning"),
    );
    return { entries, names };
  }, [filter]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  async function undo(entry: Entry & { type: "change_set" }) {
    setError(null);
    setStatus(null);
    setUndoing(entry.id);
    try {
      await api.call(changeSetsUndo, { params: { id: entry.id } });
      setStatus(`Undone: ${titleOf(entry)}.`);
    } catch (err) {
      setError(problemMessage(err));
    } finally {
      setUndoing(null);
      await load.reload();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] lg:text-[34px]">Settings</h1>
        <TabLinks items={SETTINGS_TABS} activeHref="/changelog" label="Settings sections" />
      </div>
      <div>
        <h2 className="text-[24px] lg:text-[28px]">Change log</h2>
        <p className="m-0 mt-1 text-ink-soft">Every change, who or what made it, and a way back.</p>
      </div>
      <div role="group" aria-label="Show changes to" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => {
              if (f.key === filter) return;
              setFilter(f.key);
              setStatus(null);
              setError(null);
            }}
            className="min-h-11 rounded-full bg-flour px-3.5 text-sm font-extrabold text-ink aria-pressed:bg-ink aria-pressed:text-paper"
          >
            {f.label}
          </button>
        ))}
      </div>
      <Notice>{status}</Notice>
      <FormError>{error}</FormError>
      {load.status === "loading" ? (
        <SkeletonBlock label="Loading the change log" lines={6} />
      ) : load.status === "error" ? (
        <LoadError message={load.message} onRetry={() => void load.reload()} />
      ) : load.data.entries.length === 0 ? (
        <EmptyState
          icon="refresh"
          title="Nothing here yet"
          description={
            filter === "all"
              ? "Changes you, the assistant or the planner make will appear here, each with a way back."
              : "No changes of this kind yet."
          }
        />
      ) : (
        <ol className="m-0 flex list-none flex-col rounded-[20px] bg-card p-0 shadow-card">
          {load.data.entries.map((entry) => {
            const actor = actorOf(entry, load.data.names, viewerUserId);
            const at = entry.type === "change_set" ? entry.appliedAt : entry.at;
            const title =
              entry.type === "change_set"
                ? titleOf(entry)
                : `Viewed ${entry.path.replace(/^\/api\/v1\/platform\/households\/[^/]+\/support\//, "")}`;
            const changes = entry.type === "change_set" ? (entry.detail?.changes ?? []) : [];
            const detail =
              entry.type === "support_view"
                ? entry.undo.reason
                : entry.undoneAt !== null
                  ? `Undone ${logTime(entry.undoneAt).toLowerCase()}.`
                  : entry.undo.available
                    ? null
                    : entry.undo.reason;
            const canUndo = entry.type === "change_set" && entry.undo.available;
            return (
              <li
                key={`${entry.type}-${entry.id}`}
                data-testid={`log-${entry.id}`}
                className="flex flex-col gap-3 border-b border-flour px-5 py-4 last:border-b-0 md:flex-row md:items-start md:gap-5"
              >
                <time
                  dateTime={at}
                  title={fullTime(at)}
                  className="shrink-0 text-sm font-bold text-ink-muted md:w-[110px]"
                >
                  {logTime(at)}
                </time>
                <div className="flex min-w-0 grow flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <ActorBadge kind={actor.kind}>{actor.label}</ActorBadge>
                    <span
                      className={`font-extrabold ${entry.type === "change_set" && entry.undoneAt !== null ? "text-ink-soft line-through" : ""}`}
                    >
                      {title}
                    </span>
                  </span>
                  {changes.length > 0 && <Chips changes={changes} />}
                  {detail !== null && <span className="text-sm text-ink-soft">{detail}</span>}
                </div>
                {entry.type === "change_set" && (
                  <Button
                    variant="secondary"
                    icon="refresh"
                    className="shrink-0 self-start"
                    disabled={!canUndo || undoing !== null}
                    loading={undoing === entry.id}
                    aria-label={`Undo: ${title}`}
                    onClick={() => {
                      void undo(entry);
                    }}
                  >
                    Undo
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
