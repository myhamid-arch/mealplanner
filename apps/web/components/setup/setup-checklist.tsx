// The "Getting set up" checklist (R2-ONB-6; FirstDaysPhone.dc.html): done / total, a progress bar
// and one line per item, derived from the household's data.
import { Icon } from "../ui/icon";
import type { SetupFollowups } from "./types";

export function SetupChecklist({ checklist }: { readonly checklist: SetupFollowups["checklist"] }) {
  const pct = checklist.total === 0 ? 0 : Math.round((100 * checklist.done) / checklist.total);
  return (
    <section
      aria-labelledby="setup-checklist-title"
      className="flex flex-col gap-2.5 rounded-[18px] bg-card p-3.5 shadow-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="setup-checklist-title" className="m-0 font-body text-base font-extrabold">
          Getting set up
        </h2>
        <span className="tabular font-mono text-[13px]">
          {checklist.done} / {checklist.total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Getting set up"
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.done}
        aria-valuetext={`${String(checklist.done)} of ${String(checklist.total)} done`}
        className="h-2 rounded-sm bg-flour"
      >
        <div className="h-2 rounded-sm bg-basil-text" style={{ width: `${String(pct)}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {checklist.items.map((item) => (
          <li
            key={item.key}
            data-done={item.done}
            className={`flex items-center gap-2 ${item.done ? "" : "text-ink-soft"}`}
          >
            {item.done ? (
              <Icon name="check" size={16} strokeWidth={3} className="shrink-0 text-basil-text" />
            ) : (
              <span
                aria-hidden
                className="size-4 shrink-0 rounded-full border-2 border-line-strong"
              />
            )}
            <span>
              {item.label}
              <span className="sr-only">{item.done ? " (done)" : " (to do)"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
