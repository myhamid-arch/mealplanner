// Leaf 1.4.9 (CP3 finding 2, R-61; 1.4.8 SPEC-Q-5): a saved chat recipe draft links to its recipe
// page for the day and slot the request named ("Use for Wed dinner"); without both, no link.
import { describe, expect, it } from "vitest";
import { parseCard } from "../../components/chat/cards/parse";
import { recipeUseLink } from "../../components/chat/cards/recipe-card";

const DISH = "0192f1c2-7a3b-7c4d-8e5f-000000000003";
const USE = { date: "2026-09-30", slotKey: "dinner", slotLabel: "Dinner" };

describe("recipe card: Use for <Day> <slot>", () => {
  it("links a saved draft to its recipe page with the requested day and slot", () => {
    expect(recipeUseLink(DISH, USE)).toEqual({
      href: `/recipes/${DISH}?date=2026-09-30&slot=dinner`,
      label: "Use for Wed dinner",
    });
    expect(
      recipeUseLink(DISH, {
        date: "2026-10-05",
        slotKey: "packed_school_lunch",
        slotLabel: "Packed school lunch",
      }),
    ).toEqual({
      href: `/recipes/${DISH}?date=2026-10-05&slot=packed_school_lunch`,
      label: "Use for Mon packed school lunch",
    });
  });
  it("shows no link without a requested day and slot, or without a dish", () => {
    expect(recipeUseLink(DISH, undefined)).toBeNull();
    expect(recipeUseLink(null, USE)).toBeNull();
  });
  it("the card's `use` is optional; a malformed one is reported", () => {
    const card = { type: "recipe", jobId: "j", dishes: [], rejected: [] };
    const plain = parseCard(card);
    expect(plain.ok && plain.card.type === "recipe" ? plain.card.use : "bad").toBeUndefined();
    const withUse = parseCard({ ...card, use: USE });
    expect(withUse.ok && withUse.card.type === "recipe" ? withUse.card.use : "bad").toEqual(USE);
    expect(parseCard({ ...card, use: { ...USE, date: "Wednesday" } })).toEqual({
      ok: false,
      type: "recipe",
    });
  });
});
