// leaf-1.3.6 G2 (W-11; docs/decisions/leaf-1.3.6-evals.md): the system prompt carries the three
// fixes the live eval transcripts called for, each checked against the domain it describes rather
// than against its own wording: the weekday numbering against `weekdayOf`, the allergen flags
// against the dietary-flag vocabulary and the catalogue, and role changes against the registry.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registry } from "@mealplanner/core/changes";
import { DIETARY_FLAGS, weekdayOf } from "@mealplanner/core/types";
import { SYSTEM_PROMPT, opReference, systemBlocks } from "../../src/agent/index.js";

const ROOT = join(import.meta.dirname, "../../../..");

/** A Monday; the six days after it follow. */
const MONDAY = "2026-09-28";
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function isoPlus(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The "n = Day" pairs the prompt states. */
function statedWeekdays(prompt: string): Map<string, number> {
  const line = prompt.split("\n").find((l) => l.startsWith("- Weekdays in ops"));
  const pairs = [...(line ?? "").matchAll(/(\d) = ([A-Z][a-z]+day)/g)];
  return new Map(pairs.map((m) => [m[2] ?? "", Number(m[1])]));
}

describe("G2 weekday numbering (weekend-appeal)", () => {
  it("states every weekday with the number the domain uses (weekdayOf, 0 = Monday)", () => {
    const stated = statedWeekdays(SYSTEM_PROMPT);
    expect(stated.size).toBe(7);
    DAY_NAMES.forEach((name, i) => {
      const date = isoPlus(MONDAY, i);
      expect(
        new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
          weekday: "long",
          timeZone: "UTC",
        }),
      ).toBe(name);
      expect(stated.get(name), name).toBe(weekdayOf(date));
    });
  });

  it("names the preset op for weights on particular days", () => {
    expect(registry.has("preset.upsert")).toBe(true);
    expect(SYSTEM_PROMPT).toMatch(/preset\.upsert with appliesToWeekdays/);
  });

  it("negative control: JavaScript's getDay numbering (0 = Sunday) disagrees with the domain", () => {
    const js = new Map(
      DAY_NAMES.map((name, i) => [name, new Date(`${isoPlus(MONDAY, i)}T00:00:00Z`).getUTCDay()]),
    );
    expect(DAY_NAMES.every((name, i) => js.get(name) === weekdayOf(isoPlus(MONDAY, i)))).toBe(
      false,
    );
    expect(
      statedWeekdays("- Weekdays in ops are integers: 0 = Sunday, 6 = Saturday.").get("Sunday"),
    ).not.toBe(weekdayOf(isoPlus(MONDAY, 6)));
  });
});

describe("G2 allergen flags (allergy-sesame, R2-ONB-3, R-66)", () => {
  const catalogue = (
    JSON.parse(readFileSync(join(ROOT, "data/ingredients.v1.json"), "utf8")) as {
      ingredients: { slug: string; name: string; dietary_flags: string[] }[];
    }
  ).ingredients;
  const allergyLine = SYSTEM_PROMPT.split("\n").find((l) => l.startsWith("- An allergy is")) ?? "";

  it("lists every food-naming dietary flag and says to exclude the flag", () => {
    for (const flag of DIETARY_FLAGS.filter((f) => f.startsWith("contains_")))
      expect(allergyLine, flag).toContain(flag);
    expect(allergyLine).not.toMatch(/\bvegan\b|\bvegetarian\b/);
    expect(allergyLine).toContain('kind "dietary_flag"');
    expect(allergyLine).toContain('key "contains_sesame"');
  });

  it("the sesame example names every catalogue ingredient the flag covers", () => {
    const covered = catalogue.filter((i) => i.dietary_flags.includes("contains_sesame"));
    expect(covered.length).toBeGreaterThanOrEqual(2);
    const example = /contains_sesame": ([^)]*)\)/.exec(allergyLine)?.[1]?.toLowerCase() ?? "";
    for (const i of covered)
      expect(example, i.slug).toContain(i.name.toLowerCase().split(" (")[0] ?? "");
  });

  it("the ingredient-slug example is a real catalogue slug", () => {
    const slug = /for example "([a-z0-9-]+)"/.exec(allergyLine)?.[1] ?? "";
    expect(catalogue.some((i) => i.slug === slug)).toBe(true);
  });
});

describe("G2 role changes (make-sara-admin, AGT-5, AGT-6)", () => {
  it("sends role.set through apply_change, where the registry makes it a protected proposal", () => {
    expect(registry.get("role.set")?.protected).toBe(true);
    expect(opReference()).toContain("role.set (protected)");
    const roleLine = SYSTEM_PROMPT.split("\n").find((l) => l.includes("role.set")) ?? "";
    expect(roleLine).toMatch(/apply_change/);
    expect(roleLine).toMatch(/proposal/);
    expect(roleLine).toMatch(/userId from get_household/);
  });

  it("no longer says roles are off-limits; only access and support stay on People & access", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/roles and access[^.\n]*not by you/i);
    expect(opReference()).not.toMatch(/\baccess\.|\bsupport\./);
  });

  it("negative control: the pre-fix sentence is caught", () => {
    const old =
      "- People, roles and access, and support access, are managed on the People & access screen, not by you.";
    expect(old).toMatch(/roles and access[^.\n]*not by you/i);
  });
});

describe("G2 repeat frequency (shawarma-more-often, OQ-8)", () => {
  const line = SYSTEM_PROMPT.split("\n").find((l) => l.startsWith("- How often a dish")) ?? "";

  it("sends 'more often' / 'less often' to frequency.set, whose fields it names", () => {
    const frequency = registry.get("frequency.set");
    expect(frequency).toBeDefined();
    expect(line).toMatch(/"more often" or "less often" is a frequency rule/);
    expect(line).toContain("frequency.set");
    for (const field of ["minGapDays", "maxPerWeek"]) {
      expect(line, field).toContain(field);
      expect(opReference()).toContain(`"${field}"`);
    }
  });

  it("says a liking (preference.set) does not change how often a dish repeats", () => {
    expect(registry.has("preference.set")).toBe(true);
    expect(line).toMatch(/preference\.set only changes how much a dish is liked/);
  });

  it("negative control: the prompt before the fix had no frequency line", () => {
    const before = SYSTEM_PROMPT.split("\n")
      .filter((l) => !l.startsWith("- How often a dish"))
      .join("\n");
    expect(before).not.toMatch(/frequency\.set/);
  });
});

describe("G2 the cached prefix stays byte-stable", () => {
  it("builds identical system blocks twice, with the breakpoint on the op reference", () => {
    expect(JSON.stringify(systemBlocks())).toBe(JSON.stringify(systemBlocks()));
    expect(systemBlocks()[0]?.text).toBe(SYSTEM_PROMPT);
    expect(systemBlocks().at(-1)?.cache_control).toEqual({ type: "ephemeral" });
  });
});
