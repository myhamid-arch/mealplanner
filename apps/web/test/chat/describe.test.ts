// AGT-7 diffs in words; R-34 / R-36 (SPEC-Q-13): a soft exclusion is never "may be served".
import { describe, expect, it } from "vitest";
import {
  describeTitle,
  diffLines,
  humanize,
  type Description,
} from "../../components/chat/describe";

const ZAYD = "0192f1c2-7a3b-7c4d-8e5f-0123456789ab";
const names = new Map([[ZAYD, "Zayd"]]);

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

describe("exclusion wording", () => {
  for (const hard of [true, false])
    it(`an exclusion with hard=${String(hard)} reads "Never serve", and hard is protection only`, () => {
      const d = exclusion(hard);
      expect(describeTitle(d, names)).toBe("Never serve sesame seeds to Zayd");
      const lines = diffLines(d, names);
      expect(lines.map((l) => l.label)).toEqual([
        "Who",
        "What",
        "Reason",
        "Protected from automatic change",
      ]);
      expect(lines.find((l) => l.label === "Who")?.after).toBe("Zayd");
      expect(lines.at(-1)?.after).toBe(hard ? "yes" : "no");
      expect(JSON.stringify(lines)).not.toMatch(/may be served/i);
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
      { entity: "Taste", label: "Score", before: "0.20", after: "-0.80" },
      { entity: "Taste", label: "Rule", before: "none", after: "never" },
    ]);
    expect(humanize(`Set dish preference "${ZAYD}" to -0.80`, names)).toBe(
      'Set dish preference "Zayd" to -0.80',
    );
    expect(humanize("about 0192f1c2-0000-7c4d-8e5f-0123456789ab", names)).toBe("about …");
  });
});
