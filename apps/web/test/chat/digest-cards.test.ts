// leaf-1.4.9 G1/G2 (W-9): the card schema. `insight_digest.automatic` and `job_progress.ready` are
// optional: cards stored before them (and every card the builders still write without them)
// parse as before; with them they parse to the fields the digest and Updates rows draw; malformed
// ones are reported, not drawn.
import { describe, expect, it } from "vitest";
import { parseCard } from "../../components/chat/cards/parse";

const STORED_DIGEST = {
  type: "insight_digest",
  runAt: "2026-09-27T06:30:00.000Z",
  proposals: [{ id: "p1", kind: "preference.set", title: "Never freekeh", rationale: "3 low" }],
  dropped: [],
  notes: [{ title: "n", rationale: "r" }],
};
const AUTOMATIC = {
  changeSetId: "0192f1c2-7a3b-7c4d-8e5f-000000000009",
  title: "Zayd's carb portion is 10% smaller",
  detail: "Learned from Zayd's review of Chicken and rice",
  appliedAt: "2026-09-27T19:40:00.000Z",
  undone: false,
};
const STORED_JOB = { type: "job_progress", jobId: "j", kind: "plan.generate", status: "succeeded" };
const READY = {
  title: "Monday's plan is ready",
  facts: ["All meals on target", "3 packed school lunches"],
  href: "/plan?week=2026-09-28",
  action: "Look, then send to kitchen",
};

describe("insight_digest.automatic (W-9a)", () => {
  it("a stored digest without the field still parses, with no automatic changes", () => {
    const p = parseCard(STORED_DIGEST);
    expect(p.ok && p.card.type === "insight_digest" ? p.card.automatic : "bad").toEqual([]);
  });
  it("the field parses", () => {
    const p = parseCard({ ...STORED_DIGEST, automatic: [AUTOMATIC] });
    expect(p.ok && p.card.type === "insight_digest" ? p.card.automatic : "bad").toEqual([
      AUTOMATIC,
    ]);
  });
  it("a malformed entry is reported", () => {
    expect(parseCard({ ...STORED_DIGEST, automatic: [{ ...AUTOMATIC, undone: "no" }] })).toEqual({
      ok: false,
      type: "insight_digest",
    });
  });
});

describe("job_progress.ready (W-9b)", () => {
  it("a stored job card without the field still parses", () => {
    const p = parseCard(STORED_JOB);
    expect(p.ok && p.card.type === "job_progress" ? p.card.ready : "bad").toBeUndefined();
  });
  it("the field parses", () => {
    const p = parseCard({ ...STORED_JOB, ready: READY });
    expect(p.ok && p.card.type === "job_progress" ? p.card.ready : "bad").toEqual(READY);
  });
  it("a malformed one is reported", () => {
    expect(parseCard({ ...STORED_JOB, ready: { title: "x" } })).toEqual({
      ok: false,
      type: "job_progress",
    });
  });
});
