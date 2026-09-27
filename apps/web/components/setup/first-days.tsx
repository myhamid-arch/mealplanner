"use client";
// First days (R2-ONB-6; FirstDaysPhone.dc.html): "Monday · day 2", a greeting, today's one quick
// question, the questions coming up (one per day), and the "Getting set up" checklist. Everything
// here is optional; the rest lives under the detail levels ("Add detail").
import Link from "next/link";
import { useState } from "react";
import { api, c, problemText, useLoad } from "../config/api";
import { ErrorBlock, LoadingBlock } from "../config/parts";
import { FollowupCard } from "./followup-card";
import { SetupChecklist } from "./setup-checklist";
import type { SetupFollowups } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(isoDate: string): string {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()] ?? "";
}

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function FirstDays({ name }: { readonly name: string }) {
  const loaded = useLoad(() => api.call(c.setupFollowupsGet, {}));
  const [state, setState] = useState<SetupFollowups | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [then, setThen] = useState<{ label: string; href: string } | null>(null);
  const data = state ?? loaded.data;
  if (data === null)
    return loaded.error === null || loaded.loading ? (
      <LoadingBlock label="Loading your first days" />
    ) : (
      <ErrorBlock message={loaded.error} onRetry={() => void loaded.reload()} />
    );

  const act = async (run: () => Promise<SetupFollowups>) => {
    setBusy(true);
    try {
      setState(await run());
      setError(null);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };
  const card = data.card;
  const first = name.trim().split(/\s+/)[0] ?? name;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 pb-24 lg:pb-0">
      <span className="text-[13px] font-extrabold text-ink-soft">
        {weekdayOf(data.today)} · day {data.day}
      </span>
      <h1 className="m-0 text-[28px]">
        {greeting()}, {first}
      </h1>
      {card !== null ? (
        <FollowupCard
          card={card}
          position={data.position}
          total={data.total}
          busy={busy}
          onAnswer={(choice) =>
            void act(async () => {
              const r = await api.call(c.setupFollowupsAnswer, {
                params: { key: card.key },
                body: { choice },
              });
              setThen(r.then);
              return r.followups;
            })
          }
          onLater={() =>
            void act(async () => {
              setThen(null);
              return api.call(c.setupFollowupsDismiss, { params: { key: card.key } });
            })
          }
        />
      ) : (
        <section
          aria-live="polite"
          className="flex flex-col gap-1.5 rounded-[20px] bg-card p-4 shadow-card"
        >
          <h2 className="m-0 font-body text-lg font-extrabold">
            {data.upcoming.length > 0 ? "That's today's question done" : "No questions left"}
          </h2>
          <p className="m-0 text-sm text-ink-soft">
            {data.upcoming.length > 0
              ? "The next one comes tomorrow."
              : "Everything else is optional and lives under the detail levels."}
          </p>
          {then !== null && (
            <Link href={then.href} className="text-sm font-extrabold">
              {then.label}
            </Link>
          )}
        </section>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
      {data.upcoming.length > 0 && (
        <>
          <h2 className="m-0 font-body text-xs font-extrabold tracking-[0.08em] text-ink-soft uppercase">
            Coming up, one per day
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.upcoming.map((u) => (
              <li
                key={u.key}
                className="rounded-[14px] bg-card px-3.5 py-3 text-sm shadow-[0_1px_0_var(--line)]"
              >
                {u.question}
              </li>
            ))}
          </ul>
        </>
      )}
      <SetupChecklist checklist={data.checklist} />
      <p className="m-0 text-center text-[13px] text-ink-soft">
        Everything else is optional and lives under &ldquo;Add detail&rdquo;.
      </p>
    </div>
  );
}
