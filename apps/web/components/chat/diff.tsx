import { describeTitle, diffLines, type Description } from "./describe";
import type { Names } from "./names";

/** Before → after of each op (AGT-7 proposal and applied-change cards, Insights proposals). */
export function ChangeDiff({
  descriptions,
  names,
}: {
  readonly descriptions: readonly Description[];
  readonly names: Names;
}) {
  if (descriptions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {descriptions.map((d, i) => {
        const lines = diffLines(d, names);
        return (
          <div key={`${d.kind}-${String(i)}`} className="flex flex-col gap-1">
            <span className="text-sm font-extrabold">{describeTitle(d, names)}</span>
            {lines.length > 0 && (
              <dl className="m-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {lines.map((l, j) => (
                  <div key={`${l.entity}-${l.label}-${String(j)}`} className="contents">
                    <dt className="font-bold text-ink-soft">{l.label}</dt>
                    <dd className="m-0 tabular">
                      {l.before === null ? (
                        <span className="text-basil-text">{l.after ?? "—"}</span>
                      ) : l.after === null ? (
                        <span>
                          <span className="line-through">{l.before}</span> (removed)
                        </span>
                      ) : (
                        <span>
                          {l.before} <span aria-hidden>→</span>
                          <span className="sr-only">changes to</span>{" "}
                          <strong className="text-basil-text">{l.after}</strong>
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
    </div>
  );
}
