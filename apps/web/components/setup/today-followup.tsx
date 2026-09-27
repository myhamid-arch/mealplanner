"use client";
// Today's follow-up question on the Today page (R2-ONB-6; FirstDaysPhone.dc.html, the Today tab;
// BLD-8 R-57 grants the render on 1.4.4's page). Admins only (the page renders it for them). Shows
// nothing when there is no card today; after an answer, a short note and the way to the checklist.
import Link from "next/link";
import { useState } from "react";
import { api, c, problemText, useLoad } from "../config/api";
import { FollowupCard } from "./followup-card";
import type { SetupFollowups } from "./types";

export function TodayFollowup() {
  const loaded = useLoad(() => api.call(c.setupFollowupsGet, {}));
  const [state, setState] = useState<SetupFollowups | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; href: string } | "later" | "answered" | null>(
    null,
  );
  const data = state ?? loaded.data;
  if (data === null) return null;
  const card = data.card;

  const act = async (run: () => Promise<SetupFollowups>, after: typeof done) => {
    setBusy(true);
    try {
      setState(await run());
      setDone(after);
      setError(null);
    } catch (e) {
      setError(problemText(e));
    } finally {
      setBusy(false);
    }
  };

  if (card === null && done === null) return null;
  return (
    <div className="mb-5 flex flex-col gap-2" data-today-followup>
      {card !== null ? (
        <FollowupCard
          card={card}
          position={data.position}
          total={data.total}
          busy={busy}
          onAnswer={(choice) => {
            let then: { label: string; href: string } | null = null;
            void act(async () => {
              const r = await api.call(c.setupFollowupsAnswer, {
                params: { key: card.key },
                body: { choice },
              });
              then = r.then;
              return r.followups;
            }, "answered").then(() => {
              if (then !== null) setDone(then);
            });
          }}
          onLater={() =>
            void act(
              () => api.call(c.setupFollowupsDismiss, { params: { key: card.key } }),
              "later",
            )
          }
        />
      ) : (
        <p aria-live="polite" className="m-0 rounded-xl bg-card p-3.5 text-sm shadow-card">
          {done === "later" ? "I'll ask again another day." : "Thanks, that's saved."}{" "}
          {typeof done === "object" && done !== null ? (
            <Link href={done.href} className="font-extrabold">
              {done.label}
            </Link>
          ) : (
            <Link href="/getting-started" className="font-extrabold">
              Getting set up · {data.checklist.done} / {data.checklist.total}
            </Link>
          )}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-sm font-bold text-pomegranate-text">
          {error}
        </p>
      )}
    </div>
  );
}
