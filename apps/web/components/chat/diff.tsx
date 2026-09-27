import { describeTitle, diffLines, type Description, type DiffLine } from "./describe";
import type { Names } from "./names";

/**
 * Each op in words (AGT-7 proposal and applied-change cards, Insights proposals). Fields the op
 * changes on an existing row are compared in two rows, Now / Proposed (Before / After once
 * applied), with the new values highlighted; a new row's fields are one list. Only numbers use the
 * numeric font.
 */
export function ChangeDiff({
  descriptions,
  names,
  applied = false,
}: {
  readonly descriptions: readonly Description[];
  readonly names: Names;
  /** An applied change set: "Before" / "After" instead of "Now" / "Proposed". */
  readonly applied?: boolean;
}) {
  if (descriptions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {descriptions.map((d, i) => {
        const title = describeTitle(d, names);
        const lines = diffLines(d, names);
        const updated = lines.filter((l) => l.before !== null && l.after !== null);
        const listed = lines.filter((l) => l.before === null || l.after === null);
        return (
          <div key={`${d.kind}-${String(i)}`} className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold">{title}</span>
            {updated.length > 0 && <Comparison lines={updated} title={title} applied={applied} />}
            {listed.length > 0 && (
              <dl className="m-0 grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {listed.map((l, j) => (
                  <div key={`${l.entity}-${l.label}-${String(j)}`} className="contents">
                    <dt className="font-bold text-ink-soft">{l.label}</dt>
                    <dd className="m-0">
                      {l.after === null ? (
                        <span>
                          <span className="line-through">
                            <Value line={l} v={l.before} />
                          </span>{" "}
                          (removed)
                        </span>
                      ) : (
                        <Value line={l} v={l.after} />
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

function Value({ line, v }: { readonly line: DiffLine; readonly v: string | null }) {
  return <span className={line.numeric ? "tabular" : undefined}>{v ?? "—"}</span>;
}

/** Now / Proposed (or Before / After) rows, one column per changed field. */
function Comparison({
  lines,
  title,
  applied,
}: {
  readonly lines: readonly DiffLine[];
  readonly title: string;
  readonly applied: boolean;
}) {
  const [was, will] = applied ? ["Before", "After"] : ["Now", "Proposed"];
  return (
    <div
      className="max-w-full overflow-x-auto"
      role="region"
      aria-label={`${was} and ${will.toLowerCase()}: ${title}`}
      tabIndex={0}
    >
      <table className="border-collapse text-sm" data-comparison>
        <caption className="sr-only">
          {title}: {was.toLowerCase()} and {will.toLowerCase()}
        </caption>
        <thead>
          <tr className="text-left text-xs font-extrabold text-ink-soft">
            <td className="py-1 pr-3" />
            {lines.map((l, j) => (
              <th key={`h-${String(j)}`} scope="col" className="py-1 pr-4 font-extrabold">
                {l.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <th scope="row" className="py-1.5 pr-3 text-left font-bold text-ink-soft">
              {was}
            </th>
            {lines.map((l, j) => (
              <td key={`b-${String(j)}`} className="py-1.5 pr-4 whitespace-nowrap">
                <Value line={l} v={l.before} />
              </td>
            ))}
          </tr>
          <tr className="border-t border-line">
            <th scope="row" className="py-1.5 pr-3 text-left font-bold text-ink-soft">
              {will}
            </th>
            {lines.map((l, j) => (
              <td key={`a-${String(j)}`} className="py-1.5 pr-4 whitespace-nowrap">
                <strong className="rounded bg-basil-tint px-1 text-basil-text">
                  <Value line={l} v={l.after} />
                </strong>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
