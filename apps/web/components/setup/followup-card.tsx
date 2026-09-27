"use client";
// Today's follow-up question (R2-ONB-6; FirstDaysPhone.dc.html "QUICK QUESTION · 1 OF 3"): one-tap
// choices and "Not sure · Ask me later". Shown on /getting-started; the Today page shows the same
// card once 1.4.4 carries it (R-56, R-15).
import Link from "next/link";
import type { SetupFollowups } from "./types";

type Card = NonNullable<SetupFollowups["card"]>;

export function FollowupCard({
  card,
  position,
  total,
  busy,
  onAnswer,
  onLater,
}: {
  readonly card: Card;
  readonly position: number;
  readonly total: number;
  readonly busy: boolean;
  readonly onAnswer: (choice: string) => void;
  readonly onLater: () => void;
}) {
  return (
    <section
      aria-labelledby="followup-question"
      data-followup={card.key}
      className="flex flex-col gap-3 rounded-[20px] bg-agent p-4 text-on-agent"
    >
      <span className="text-xs font-extrabold tracking-[0.08em] text-aubergine-tint">
        QUICK QUESTION · {position} OF {total}
      </span>
      <h2 id="followup-question" className="m-0 font-body text-lg leading-snug font-extrabold">
        {card.question}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {card.choices.map((choice, i) => (
          <button
            key={choice.id}
            type="button"
            disabled={busy}
            onClick={() => {
              onAnswer(choice.id);
            }}
            className={`min-h-12 rounded-xl px-3 font-extrabold disabled:opacity-60 ${
              i === 0 ? "bg-card text-agent" : "bg-agent-raised text-on-agent"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          disabled={busy}
          onClick={onLater}
          className="min-h-11 self-start py-1 text-sm font-extrabold text-aubergine-tint disabled:opacity-60"
        >
          Not sure · Ask me later
        </button>
        {card.more !== null && (
          <Link href={card.more.href} className="text-sm font-extrabold text-on-agent underline">
            {card.more.label}
          </Link>
        )}
      </div>
    </section>
  );
}
