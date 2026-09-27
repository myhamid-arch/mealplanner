import { dayTitle } from "../../reviews/targets";
import { FitBadge } from "./fit";
import { macroRow, type MacroTableCard as Card } from "./parse";

const fmt = (m: { kcal: number; protein: number; carbs: number; fat: number } | null) =>
  m === null
    ? "—"
    : `${String(Math.round(m.kcal))} · P${String(Math.round(m.protein))} C${String(Math.round(m.carbs))} F${String(Math.round(m.fat))}`;

/** AGT-7 `macro_table`: member × slot, targets against actuals (row shape: SPEC-Q-4). */
export function MacroTableCardView({ card }: { readonly card: Card }) {
  const rows = card.rows.map(macroRow);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-card" data-card="macro_table">
      <span className="font-extrabold">Targets and actuals · {dayTitle(card.date)}</span>
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Targets against actuals per person and meal</caption>
          <thead>
            <tr className="text-left text-xs font-extrabold text-ink-soft">
              <th scope="col" className="py-1 pr-3">
                Who
              </th>
              <th scope="col" className="py-1 pr-3">
                Meal
              </th>
              <th scope="col" className="py-1 pr-3">
                Target
              </th>
              <th scope="col" className="py-1 pr-3">
                Actual
              </th>
              <th scope="col" className="py-1">
                Fit
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) =>
              r === null ? (
                <tr key={`bad-${String(i)}`}>
                  <td colSpan={5} className="py-1 text-ink-soft">
                    —
                  </td>
                </tr>
              ) : (
                <tr key={`${r.member}-${r.slot}-${String(i)}`} className="border-t border-line">
                  <th scope="row" className="py-1 pr-3 text-left font-extrabold">
                    {r.member}
                  </th>
                  <td className="py-1 pr-3">{r.slot}</td>
                  <td className="py-1 pr-3 whitespace-nowrap tabular">{fmt(r.target)}</td>
                  <td className="py-1 pr-3 whitespace-nowrap tabular">{fmt(r.actual)}</td>
                  <td className="py-1">
                    {r.fitStatus === undefined ? "—" : <FitBadge status={r.fitStatus} />}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
