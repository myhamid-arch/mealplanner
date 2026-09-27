// FBK-2 / FBK-3 on the review screens: tag labels and chips, the part summary, the feed's grouping
// of a detailed review into one card (SPEC-Q-6), and who may be reviewed for (SPEC-Q-15).
import { describe, expect, it } from "vitest";
import { groupReviews } from "../../components/reviews/group";
import { toggleTag } from "../../components/reviews/tag-chips";
import { partSummary, tagLabel, tagTone } from "../../components/reviews/tags";
import type { Review } from "../../components/reviews/targets";
import { reviewableMembers, type Viewer } from "../../components/reviews/viewer";

const T0 = Date.UTC(2026, 8, 27, 19, 0, 0);
function review(id: string, over: Partial<Review>): Review {
  return {
    id,
    authorUserId: "sara",
    authorName: "Sara",
    onBehalfOfMemberId: "zayd",
    targetType: "plan_meal",
    targetId: "meal",
    planMealId: "meal",
    rating: null,
    tags: [],
    comment: null,
    parentReviewId: null,
    createdAt: new Date(T0).toISOString(),
    editedAt: null,
    reactions: { agree: 0, disagree: 0, helpful: 0 },
    ...over,
  };
}

describe("tags", () => {
  it("labels FBK-3 tags, the mockups' custom tags and unknown custom tags", () => {
    expect(tagLabel("too_salty")).toBe("Too salty");
    expect(tagLabel("not_for_me")).toBe("Not for me");
    expect(tagLabel("kids_approved")).toBe("Kids approved");
    expect(tagTone("loved_it")).toBe("basil");
    expect(tagTone("too_much")).toBe("saffron");
    expect(tagTone("never_again")).toBe("pomegranate");
  });

  it("summarises a part, and toggles one amount at a time", () => {
    expect(partSummary([])).toEqual({ text: "—", tone: "neutral" });
    expect(partSummary(["crispy"]).text).toBe("Loved");
    expect(partSummary(["crispy", "too_much"]).text).toBe("Too much");
    expect(partSummary(["not_for_me", "too_sour"]).text).toBe("Not for me");
    const amount = ["too_much", "too_little", "just_right"];
    expect(toggleTag(["dry", "too_much"], "too_little", amount)).toEqual(["dry", "too_little"]);
    expect(toggleTag(["dry"], "dry")).toEqual([]);
  });
});

describe("groupReviews", () => {
  it("puts a detailed review's part reviews and replies under its meal review", () => {
    const meal = review("m", { rating: 4, tags: ["more_often"] });
    const part = review("p", {
      targetType: "component",
      targetId: "rice",
      tags: ["too_much"],
      createdAt: new Date(T0 + 1000).toISOString(),
    });
    const other = review("o", {
      targetType: "component",
      targetId: "fish",
      tags: ["dry"],
      createdAt: new Date(T0 + 3_600_000).toISOString(),
    });
    const reply = review("r", { parentReviewId: "m", comment: "Noted", onBehalfOfMemberId: null });
    const groups = groupReviews([other, reply, part, meal], (r) =>
      r.targetId === "rice" ? "Rice" : "Fish",
    );
    expect(groups.map((g) => g.main.id)).toEqual(["o", "m"]);
    const m = groups.find((g) => g.main.id === "m");
    expect(m?.parts.map((p) => [p.name, p.review.id])).toEqual([["Rice", "p"]]);
    expect(m?.replies.map((x) => x.id)).toEqual(["r"]);
  });
});

describe("reviewableMembers", () => {
  const base: Viewer = {
    userId: "u",
    name: "Layla",
    role: "member",
    memberId: "layla",
    household: { membersReviewForSiblings: false } as Viewer["household"],
    members: [
      { id: "sara", displayName: "Sara", birthYear: 1987 },
      { id: "layla", displayName: "Layla", birthYear: 2008 },
      { id: "zayd", displayName: "Zayd", birthYear: 2016 },
    ] as Viewer["members"],
  };
  it("admins review for anyone; a member for themselves, and younger siblings when allowed", () => {
    expect(reviewableMembers({ ...base, role: "admin" }).map((m) => m.id)).toEqual([
      "sara",
      "layla",
      "zayd",
    ]);
    expect(reviewableMembers(base).map((m) => m.id)).toEqual(["layla"]);
    const allowed = {
      ...base,
      household: { membersReviewForSiblings: true } as Viewer["household"],
    };
    expect(reviewableMembers(allowed).map((m) => m.id)).toEqual(["layla", "zayd"]);
  });
});
