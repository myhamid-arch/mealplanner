// R2-ONB-5: the conversation's second answer, one message for everyone's targets.
import { describe, expect, it } from "vitest";
import { targetsByPerson } from "../../components/chat/setup/chat-onboarding";
import { autoTitle, sendProblem } from "../../components/chat/use-conversation";
import { ApiProblem } from "@mealplanner/api-contract/client";

describe("targetsByPerson", () => {
  it("reads each person's numbers after their name, in any R2-ONB-3 format", () => {
    const out = targetsByPerson(
      "Omar 2150 cal, 180p 200c 70f; Sara is 1655 / 130 / 160 / 55",
      ["Omar", "Sara", "Zayd"],
      "Omar",
    );
    expect(out.map((t) => [t.person, t.numbers.kcal, t.numbers.proteinG, t.numbers.fatG])).toEqual([
      ["Omar", 2150, 180, 70],
      ["Sara", 1655, 130, 55],
    ]);
  });

  it("reads 'I' as the admin when the admin is in the family, and skips people without numbers", () => {
    const out = targetsByPerson(
      "I'm 2150 cal 180p 200c 70f. Zayd nothing.",
      ["Omar", "Zayd"],
      "Omar Khalil",
    );
    expect(out.map((t) => t.person)).toEqual(["Omar"]);
  });
});

describe("chat problems and titles", () => {
  const problem = (status: number, code: string) =>
    new ApiProblem({ type: "about:blank", title: "", status, code });
  it("names each problem before a turn (409, 429, 503) as its own state", () => {
    expect(sendProblem(problem(409, "turn_in_progress")).kind).toBe("busy");
    expect(sendProblem(problem(429, "rate_limited")).kind).toBe("limit");
    expect(sendProblem(problem(503, "assistant_unavailable")).kind).toBe("unavailable");
    expect(sendProblem(problem(500, "internal_error")).kind).toBe("other");
  });

  it("titles a conversation from its first line, cut at a word", () => {
    expect(autoTitle("Plan tomorrow\nand more")).toBe("Plan tomorrow");
    const long = autoTitle(
      "Why is Omar's Wednesday lunch always so high in fat compared with the rest of the week?",
    );
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith("…")).toBe(true);
    expect(autoTitle("   ")).toBe("New conversation");
  });
});
