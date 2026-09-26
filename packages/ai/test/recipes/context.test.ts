// Unit tests of the REC-3 context builder and the append-only follow-up (G2, G1).
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import {
  GenerationContextError,
  buildGenerationContext,
  echoableContent,
  followUpMessage,
  scrubNames,
} from "../../src/recipes/index.js";
import { F1_DINNER_DATE, f1Config } from "./support/household.js";

describe("REC-3 context", () => {
  it("lists only the members attending the slot, with the union of hard exclusions", () => {
    const cfg = f1Config();
    // Tuesday lunch: the children have packed school lunch and Adult A a packed work lunch.
    const lunch = buildGenerationContext({ config: cfg, date: F1_DINNER_DATE, slotKey: "lunch" });
    expect(lunch.context.attendees.map((a) => a.label)).toEqual(["Adult A"]);
    expect(lunch.context.exclusions.dietaryFlags).toEqual([]);
    expect(lunch.solveTargets.map((t) => t.label)).toEqual(["Adult A"]);
    const school = buildGenerationContext({
      config: cfg,
      date: F1_DINNER_DATE,
      slotKey: "packed_school_lunch",
    });
    expect(school.context.attendees.map((a) => [a.label, a.targeted])).toEqual([
      ["Adult A", false],
      ["Child A", false],
      ["Child B", false],
    ]);
    expect(school.context.exclusions.dietaryFlags).toEqual(["contains_sesame"]);
    expect(school.context.slot).toMatchObject({ key: "packed_school_lunch", isPacked: true });
    expect(school.solveTargets).toEqual([]);
  });

  it("gives the solver the resolver's targets under the label, never the member id", () => {
    const { context, solveTargets } = buildGenerationContext({
      config: f1Config(),
      date: F1_DINNER_DATE,
      slotKey: "dinner",
    });
    for (const t of solveTargets) {
      expect(t.target.memberId).toBe(t.label);
      expect(t.member.memberId).toBe(t.label);
      const attendee = context.attendees.find((a) => a.label === t.label);
      expect(attendee?.plateTarget).toEqual({
        kcal: t.target.kcal,
        protein: t.target.protein,
        carbs: t.target.carbs,
        fat: t.target.fat,
      });
    }
    expect(solveTargets.find((t) => t.label === "Adult A")?.member.exclusions.dietaryFlags).toEqual(
      [],
    );
  });

  it("refuses an inactive slot or a count below 1", () => {
    expect(() =>
      buildGenerationContext({ config: f1Config(), date: F1_DINNER_DATE, slotKey: "midnight" }),
    ).toThrow(GenerationContextError);
    expect(() =>
      buildGenerationContext({
        config: f1Config(),
        date: F1_DINNER_DATE,
        slotKey: "dinner",
        count: 0,
      }),
    ).toThrow(GenerationContextError);
  });

  it("scrubs names, shared family names and e-mail addresses from free text", () => {
    const names = new Map([
      ["Omar Haddad", "Adult A"],
      ["Layla Haddad", "Adult B"],
      ["Sami", "a family member"],
    ]);
    expect(
      scrubNames(
        "OMAR said Layla's friend Sami (omar.h@example.ae) likes the Haddad recipe; Omari too",
        names,
      ),
    ).toBe(
      "Adult A said Adult B's friend a family member ([email]) likes the [family name] recipe; Omari too",
    );
  });
});

describe("REC-5 follow-up", () => {
  it("echoes the assistant content unchanged", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "s1" },
      { type: "text", text: "{}", citations: null },
    ] as unknown as BetaContentBlock[];
    expect(echoableContent(content)).toEqual(content);
  });

  it("drops thinking before the final fallback marker, as the fallback contract requires", () => {
    const content = [
      { type: "thinking", thinking: "", signature: "declined" },
      { type: "text", text: '{"dish', citations: null },
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "", signature: "served" },
      { type: "text", text: "{}", citations: null },
    ] as unknown as BetaContentBlock[];
    expect(echoableContent(content).map((b) => b.type)).toEqual([
      "text",
      "fallback",
      "thinking",
      "text",
    ]);
  });

  it("lists every reason and the number of dishes needed", () => {
    const text = followUpMessage(
      [
        { dishName: "A", reasons: ["r1", "r2"] },
        { dishName: "B", reasons: ["r3"] },
      ],
      2,
    );
    expect(text).toContain("Write 2 replacement dishes");
    expect(text).toContain("- A: r1; r2");
    expect(text).toContain("- B: r3");
  });
});
