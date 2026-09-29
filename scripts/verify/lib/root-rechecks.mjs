// The node gates' re-checks of their measured figures, reused by the root gates (R-80). node-1.2,
// node-1.3 and node-1.4's verify scripts run their gate when imported, so the functions below are
// copies, byte-identical to their sources (CP1 amendment 2):
// - sc1Ok, median, sc2Ok: scripts/verify/node-1.2.mjs at 5d5e129;
// - sc3Ok, sc4Ok: scripts/verify/node-1.3.mjs at cf6b357;
// - recheck (exported as recheckSc5): scripts/verify/node-1.4.mjs at cf6b357.
// `node scripts/verify/root.mjs --gate R1` does not need them; each SC gate checks, before it runs,
// that every copy still equals its source (`copiesMatchSources`), so a drift fails the gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./node.mjs";

/** Re-checks of the measured figures; each also runs on a known-bad record that must fail. */
const sc1Ok = (m) =>
  m !== undefined &&
  m.total > 0 &&
  m.failures.length === 0 &&
  m.inTolerance + m.flagged + m.noPlateFlagged === m.total &&
  m.storedDrift === 0;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};
/** SC-2 recomputed here from the per-seed counts, not from the test's aggregate. */
const sc2Ok = (perSeed) => {
  if (perSeed?.length !== 10 || perSeed.some((s) => !(s.baseline > 0))) return false;
  const reductions = perSeed.map((s) => 1 - s.economy / s.baseline);
  return median(reductions) >= 0.08 && Math.min(...reductions) >= 0;
};

const sc3Ok = (m) =>
  m !== undefined &&
  m.appealAfter < m.appealBefore &&
  m.scoreAfter < m.scoreBefore &&
  m.others > 0 &&
  m.othersUnchanged === true &&
  m.proposals === 1;
const sc4Ok = (m) =>
  m !== undefined &&
  m.actor === "agent" &&
  m.source === "agent_apply" &&
  m.restoreDiff === 0 &&
  m.undone === true &&
  m.entities.length > 0 &&
  m.entities.every((e) => !m.excluded.includes(e)) &&
  m.turnWrites.every((t) => m.excluded.includes(t));

function recheck(report, m) {
  for (const w of ["390", "1280"]) {
    const one = (check) => m.find((r) => r.check === check && r.width === w);
    const onb = one("onboarding");
    console.log(
      `       measured at ${w} px: ${String(onb?.questions)} onboarding questions (${String(onb?.requiredInputs)} required inputs), ${String(onb?.timezone)}, ${String(onb?.countryCode)}, ${String(onb?.unitSystem)}; first plan ${String(onb?.meals)} meals; plan shows ${String(one("plan")?.dishes)} dishes; cook sheet shows ${String(one("cooksheet")?.dish)} with "${String(one("cooksheet")?.makes)}"; ${String(one("review")?.stored)} review stored; accepted proposal ${String(one("chat")?.changeSetId)} (${String(one("chat")?.source)})`,
    );
    const ok = (o) =>
      o !== undefined &&
      o.questions === 5 &&
      o.timezone === "Asia/Dubai" &&
      o.countryCode === "AE" &&
      o.unitSystem === "metric" &&
      o.meals > 0;
    report.check(
      ok(onb),
      `${w} px: five questions before the summary, UAE and metric, a first plan`,
    );
    report.check(
      /^makes \d+ g$/.test(one("cooksheet")?.makes ?? "") &&
        one("review")?.stored === 1 &&
        one("chat")?.source === "proposal_accept",
      `${w} px: the cook sheet shows the planned dinner and its batch in grams, the review is stored, the accepted proposal is in the log`,
    );
  }
  const axe = m.filter((r) => r.check === "axe");
  const serious = axe.reduce((n, r) => n + r.serious, 0);
  const screens = new Set(axe.map((r) => r.where));
  console.log(
    `       measured: axe on ${String(screens.size)} screens × light/dark (${String(axe.length)} runs), ${String(serious)} serious or critical`,
  );
  report.check(
    axe.length >= 20 && serious === 0,
    "axe: no serious or critical finding on any screen",
  );
  const control = m.find((r) => r.check === "axe-control");
  console.log(
    `       measured (negative control): axe on the known-bad page: ${(control?.ids ?? []).join(", ")}`,
  );
  report.check(
    ["link-name", "color-contrast"].every((id) => (control?.ids ?? []).includes(id)),
    "negative control: the axe helper reports the known-bad page's serious findings",
  );
  const model = m.find((r) => r.check === "model");
  console.log(
    `       measured: ${String(model?.requests)} model request(s): ${String(model?.parse)} onboarding parse, ${String(model?.chat)} chat; ${String(model?.failures?.length)} unrecorded`,
  );
  report.check(
    model?.failures?.length === 0 && model?.parse > 0 && model?.chat === 2,
    "the recorded model answered every request",
  );
}

/** The top-level statement of `text` that starts with `head`, up to the next top-level line. */
function statement(text, head) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(head));
  if (i === -1) return undefined;
  let j = i + 1;
  while (j < lines.length && (lines[j] === "" || /^[\s}]/.test(lines[j]))) j += 1;
  return lines.slice(i, j).join("\n").trimEnd();
}

const COPIES = [
  ["scripts/verify/node-1.2.mjs", ["const sc1Ok = ", "const median = ", "const sc2Ok = "]],
  ["scripts/verify/node-1.3.mjs", ["const sc3Ok = ", "const sc4Ok = "]],
  ["scripts/verify/node-1.4.mjs", ["function recheck(report, m) {"]],
];

/**
 * Every copied definition, compared with its source; returns the ones that differ or are gone.
 * `read` reads a source file (the negative control passes one that changes a source).
 */
export function copiesMatchSources(read = (file) => readFileSync(join(ROOT, file), "utf8")) {
  const mine = readFileSync(new URL(import.meta.url), "utf8");
  const drift = [];
  for (const [file, heads] of COPIES) {
    const source = read(file);
    for (const head of heads) {
      const a = statement(source, head);
      if (a === undefined || a !== statement(mine, head)) drift.push(`${file}: ${head.trim()}`);
    }
  }
  return drift;
}

export { sc1Ok, median, sc2Ok, sc3Ok, sc4Ok, recheck as recheckSc5 };
