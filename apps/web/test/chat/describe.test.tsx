// AGT-7 diffs in words; R-34 / R-36 (SPEC-Q-13): a soft exclusion is never "may be served".
// CP3 finding 1: labels instead of stored values, catalogue names for slugs, defaults of a new row
// left out, and Now / Proposed rows when an op updates an existing row.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeDiff } from "../../components/chat/diff";
import {
  describeTitle,
  diffLines,
  humanize,
  type Description,
} from "../../components/chat/describe";

const ZAYD = "0192f1c2-7a3b-7c4d-8e5f-0123456789ab";
const names = new Map([
  [ZAYD, "Zayd"],
  ["ingredient:sesame_seeds", "Sesame seeds"],
]);

const exclusion = (hard: boolean): Description => ({
  kind: "exclusion.add",
  area: "taste",
  title: `Exclude ingredient "sesame_seeds" (dislike)`,
  changes: [
    { entity: "exclusion", key: { id: "x" }, field: "id", before: undefined, after: "x" },
    { entity: "exclusion", key: { id: "x" }, field: "memberId", before: undefined, after: ZAYD },
    {
      entity: "exclusion",
      key: { id: "x" },
      field: "key",
      before: undefined,
      after: "sesame_seeds",
    },
    { entity: "exclusion", key: { id: "x" }, field: "reason", before: undefined, after: "dislike" },
    { entity: "exclusion", key: { id: "x" }, field: "hard", before: undefined, after: hard },
    {
      entity: "exclusion",
      key: { id: "x" },
      field: "createdAt",
      before: undefined,
      after: "2026-09-27T00:00:00Z",
    },
  ],
});

describe("exclusion.add", () => {
  for (const hard of [true, false])
    it(`hard=${String(hard)} reads "Never serve", with labels and the catalogue name`, () => {
      const d = exclusion(hard);
      expect(describeTitle(d, names)).toBe("Never serve sesame seeds to Zayd");
      const lines = diffLines(d, names);
      expect(lines.map((l) => [l.label, l.after])).toEqual([
        ["Who", "Zayd"],
        ["What", "Sesame seeds"],
        ["Reason", "Dislike"],
        // Not protected is the default of a new exclusion, so it is not listed.
        ...(hard ? [["Protected from automatic change", "Yes"]] : []),
      ]);
      expect(lines.every((l) => !l.numeric)).toBe(true);
      const html = renderToStaticMarkup(<ChangeDiff descriptions={[d]} names={names} />);
      expect(html).not.toMatch(/may be served|sesame_seeds|dislike|data-comparison/);
      expect(html).not.toContain('class="tabular"');
    });

  it("an unknown slug falls back to words", () => {
    const d = exclusion(false);
    expect(describeTitle(d, new Map([[ZAYD, "Zayd"]]))).toBe("Never serve sesame seeds to Zayd");
    expect(diffLines(d, new Map()).find((l) => l.label === "What")?.after).toBe("Sesame seeds");
  });
});

describe("diffLines", () => {
  it("shows changed fields only, with before and after, and names preference rules plainly", () => {
    const lines = diffLines(
      {
        kind: "preference.set",
        area: "taste",
        title: `Set dish preference "${ZAYD}" to -0.80`,
        changes: [
          { entity: "preference", key: { id: "p" }, field: "score", before: 0.2, after: -0.8 },
          { entity: "preference", key: { id: "p" }, field: "locked", before: false, after: false },
          { entity: "preference", key: { id: "p" }, field: "hard", before: "none", after: "never" },
          { entity: "preference", key: { id: "p" }, field: "evidenceWeight", before: 1, after: 2 },
          {
            entity: "preference",
            key: { id: "p" },
            field: "source",
            before: "learned",
            after: "proposal",
          },
        ],
      },
      names,
    );
    expect(lines).toEqual([
      { entity: "Taste", label: "Score", before: "0.20", after: "-0.80", numeric: true },
      { entity: "Taste", label: "Rule", before: "None", after: "Never serve", numeric: false },
    ]);
    expect(humanize(`Set dish preference "${ZAYD}" to -0.80`, names)).toBe(
      'Set dish preference "Zayd" to -0.80',
    );
    expect(humanize("about 0192f1c2-0000-7c4d-8e5f-0123456789ab", names)).toBe("about …");
  });
});

describe("preference.set on an existing row", () => {
  const update: Description = {
    kind: "preference.set",
    area: "taste",
    title: 'Set cuisine preference "italian" to 0.50',
    changes: [
      { entity: "preference", key: { id: "p" }, field: "score", before: 0.2, after: 0.5 },
      { entity: "preference", key: { id: "p" }, field: "locked", before: false, after: true },
    ],
  };

  it("names the slug in the title", () => {
    expect(describeTitle(update, names)).toBe("Set cuisine preference Italian to 0.50");
  });

  it("compares Now and Proposed, numbers in the numeric font, new values highlighted", () => {
    const html = renderToStaticMarkup(<ChangeDiff descriptions={[update]} names={names} />);
    expect(html).toContain("data-comparison");
    const rows = [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|"),
    );
    expect(rows).toEqual(["|Score|Locked|", "|Now|0.20|No|", "|Proposed|0.50|Yes|"]);
    expect(html).toContain('<span class="tabular">0.50</span>');
    expect(html).not.toContain('<span class="tabular">Yes</span>');
    expect(html.match(/<strong/g)).toHaveLength(2);
  });

  it("reads Before and After once applied", () => {
    const html = renderToStaticMarkup(<ChangeDiff descriptions={[update]} names={names} applied />);
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).not.toContain(">Proposed<");
  });

  it("a new row stays one list, without the defaults it repeats", () => {
    const created: Description = {
      ...update,
      changes: [
        { entity: "preference", key: { id: "p" }, field: "entityType", after: "cuisine" },
        { entity: "preference", key: { id: "p" }, field: "entityKey", after: "italian" },
        { entity: "preference", key: { id: "p" }, field: "score", after: 0.5 },
        { entity: "preference", key: { id: "p" }, field: "locked", after: false },
        { entity: "preference", key: { id: "p" }, field: "hard", after: "none" },
      ],
    };
    expect(diffLines(created, names).map((l) => [l.label, l.after])).toEqual([
      ["About", "Cuisine"],
      ["Which", "Italian"],
      ["Score", "0.50"],
    ]);
    const html = renderToStaticMarkup(<ChangeDiff descriptions={[created]} names={names} />);
    expect(html).not.toContain("data-comparison");
  });

  it("a new frequency rule lists what it sets, not its empty or default fields", () => {
    const rule: Description = {
      kind: "frequency.set",
      area: "taste",
      title: "Set frequency rule",
      changes: [
        { entity: "frequency_rule", key: { id: "f" }, field: "memberId", after: null },
        { entity: "frequency_rule", key: { id: "f" }, field: "minGapDays", after: 3 },
        { entity: "frequency_rule", key: { id: "f" }, field: "maxPerWeek", after: null },
        { entity: "frequency_rule", key: { id: "f" }, field: "locked", after: false },
      ],
    };
    expect(diffLines(rule, names).map((l) => [l.label, l.after])).toEqual([
      ["Who", "Everyone"],
      ["Minimum gap (days)", "3"],
    ]);
  });
});
