// G1 (REC-5, REC-2 DM-7, REC-6): with recorded responses the pipeline accepts a valid batch and
// rejects one of each REC-5 defect class, with each reason surfaced.
import { describe, expect, it } from "vitest";
import { generateRecipes } from "../../src/recipes/index.js";
import { batchFixture, batchResponse } from "./support/recorded.js";
import { DEFECTS_VALID_DISH, DEFECT_CLASSES, INFEASIBLE_DISH } from "./support/expectations.js";
import { f1DinnerRequest, libraryWithChicken, scenario } from "./support/scenario.js";

describe("G1 valid batch", () => {
  it("accepts every dish of a valid batch, records the call and saves the survivors", async () => {
    const valid = batchFixture("valid-batch");
    const s = scenario([batchResponse(valid)]);
    const run = await generateRecipes(s.deps, f1DinnerRequest());

    expect(run.calls).toBe(1);
    expect(run.rejected).toEqual([]);
    expect(run.infeasible).toEqual([]);
    expect(run.candidates.map((c) => c.dish.name)).toEqual(valid.dishes.map((d) => d.name));
    for (const c of run.candidates) {
      expect(c.plates.map((p) => [p.label, p.status])).toEqual([
        ["Adult A", "in_tolerance"],
        ["Adult B", "in_tolerance"],
      ]);
      // Every variant has computed nutrition (REC-1: the engine decides the numbers).
      expect(c.nutrition.map((row) => row.length)).toEqual(
        c.dish.components.map((comp) => comp.variants.length),
      );
    }
    expect(s.recorder.requests).toHaveLength(1);
    expect(s.ports.records).toHaveLength(1);
    expect(s.ports.records[0]).toMatchObject({
      purpose: "recipe",
      model: "claude-fable-5-1",
      stopReason: "end_turn",
      inputTokens: 2100,
      outputTokens: 6400,
      validationErrors: null,
    });
    expect(run.generationIds).toEqual(["gen-1"]);
    expect(s.ports.saved).toHaveLength(1);
    expect(s.ports.saved[0]?.generationIds).toEqual(["gen-1"]);
    expect(s.ports.saved[0]?.dishes.map((d) => d.dish.name)).toEqual(
      valid.dishes.map((d) => d.name),
    );
  });

  it("passes count through (REC-6: count from the request) and does not follow up when met", async () => {
    const valid = batchFixture("valid-batch");
    const one = { dishes: valid.dishes.slice(0, 1), newIngredients: [] };
    const s = scenario([batchResponse(one)]);
    const run = await generateRecipes(s.deps, f1DinnerRequest(undefined, { count: 1 }));
    expect(run.calls).toBe(1);
    expect(run.candidates).toHaveLength(1);
    const user = (s.recorder.requests[0]?.body.messages as Array<{ content: string }>)[0]?.content;
    expect(user).toContain('Write 1 new dish for the "dinner" slot.');
  });
});

describe("G1 defect classes", () => {
  it("rejects one dish of each REC-5 defect class with its reason, follows up once, keeps the infeasible dish", async () => {
    const defects = batchFixture("defects-batch");
    const followUp = batchFixture("follow-up-batch");
    const first = batchResponse(defects) as { status: number; body: unknown };
    const s = scenario([first, batchResponse(followUp, { cacheRead: 14000 })], {
      existingDishes: libraryWithChicken(),
    });
    const run = await generateRecipes(s.deps, f1DinnerRequest());

    // Every defect class is rejected at its own step, with its code and a message.
    expect(run.rejected).toHaveLength(DEFECT_CLASSES.length);
    for (const expected of DEFECT_CLASSES) {
      const r = run.rejected.find((x) => x.dishName === expected.dish);
      expect(r, expected.dish).toBeDefined();
      expect(r?.call).toBe(1);
      expect(new Set(r?.reasons.map((x) => x.code))).toEqual(new Set(expected.codes));
      for (const reason of r?.reasons ?? []) {
        expect(reason.step).toBe(expected.step);
        expect(reason.message.length).toBeGreaterThan(20);
      }
    }
    // Infeasible (step 7): kept and saved, not a candidate, with a reason per attendee.
    expect(run.infeasible.map((d) => d.dish.name)).toEqual([INFEASIBLE_DISH]);
    const infeasible = run.infeasible[0];
    expect(infeasible?.reasons.map((r) => [r.step, r.code])).toEqual([
      [7, "infeasible"],
      [7, "infeasible"],
    ]);
    expect(infeasible?.reasons[0]?.message).toContain("Adult A");
    expect(infeasible?.reasons[1]?.message).toContain("Adult B");

    // Two survivors of three → exactly one follow-up; its dish is accepted.
    expect(run.calls).toBe(2);
    expect(s.recorder.requests).toHaveLength(2);
    expect(run.candidates.map((c) => [c.dish.name, c.call])).toEqual([
      [DEFECTS_VALID_DISH, 1],
      [followUp.dishes[0]?.name, 2],
    ]);

    // The follow-up only appends: the first request's messages, the model's response unchanged,
    // then one user message quoting every rejection reason.
    const firstMessages = s.recorder.requests[0]?.body.messages as unknown[];
    const secondMessages = s.recorder.requests[1]?.body.messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(secondMessages.slice(0, firstMessages.length)).toEqual(firstMessages);
    expect(secondMessages).toHaveLength(firstMessages.length + 2);
    const assistant = secondMessages[firstMessages.length];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toEqual((first.body as { content: unknown }).content);
    const note = secondMessages[firstMessages.length + 1];
    expect(note?.role).toBe("user");
    const noteText = String(note?.content);
    expect(noteText).toContain("Write 1 replacement dish");
    for (const r of run.rejected.filter((x) => x.call === 1))
      for (const reason of r.reasons) expect(noteText).toContain(reason.message);
    expect(s.recorder.requests[1]?.body.system).toEqual(s.recorder.requests[0]?.body.system);

    // DM-7: one record per call, reasons surfaced in validation_errors; one change set.
    expect(s.ports.records).toHaveLength(2);
    const errors = s.ports.records[0]?.validationErrors as Array<{ dish: string; code: string }>;
    for (const expected of DEFECT_CLASSES)
      for (const code of expected.codes)
        expect(errors).toContainEqual(expect.objectContaining({ dish: expected.dish, code }));
    expect(errors).toContainEqual(
      expect.objectContaining({ dish: INFEASIBLE_DISH, code: "infeasible" }),
    );
    expect(s.ports.records[1]?.validationErrors).toBeNull();
    expect(s.ports.records[1]?.cacheReadTokens).toBe(14000);
    expect(s.ports.saved).toHaveLength(1);
    expect(s.ports.saved[0]?.generationIds).toEqual(["gen-1", "gen-2"]);
    expect(s.ports.saved[0]?.dishes.map((d) => [d.dish.name, d.candidate])).toEqual([
      [INFEASIBLE_DISH, false],
      [DEFECTS_VALID_DISH, true],
      [followUp.dishes[0]?.name, true],
    ]);
  });

  it("does not detect a duplicate when the library does not hold the dish (control)", async () => {
    const defects = batchFixture("defects-batch");
    const s = scenario([batchResponse(defects), batchResponse(batchFixture("follow-up-batch"))]);
    const run = await generateRecipes(s.deps, f1DinnerRequest());
    expect(run.rejected.map((r) => r.dishName)).not.toContain(DEFECT_CLASSES[4]?.dish);
    expect(run.calls).toBe(1);
  });
});
