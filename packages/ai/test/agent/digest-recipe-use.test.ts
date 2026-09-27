// Leaf 1.4.9 (R-61, R-66): `create_recipe` takes the day the admin names, so a saved draft can
// link to "Use for <Day> <slot>". The date is optional and must be a real calendar date.
import { describe, expect, it } from "vitest";
import { TOOL_SCHEMAS } from "../../src/agent/tools/schemas.js";

describe("create_recipe: the day the recipe is for (R-66)", () => {
  const schema = TOOL_SCHEMAS.create_recipe;
  it("accepts a named day with a slot, and no day at all", () => {
    expect(
      schema.parse({ request: "Something Italian", slot: "dinner", date: "2026-09-30" }),
    ).toEqual({ request: "Something Italian", slot: "dinner", date: "2026-09-30", count: 1 });
    expect(schema.parse({ request: "Something Italian" })).toEqual({
      request: "Something Italian",
      count: 1,
    });
  });
  it("refuses a day that is not a calendar date", () => {
    expect(schema.safeParse({ request: "x", date: "Wednesday" }).success).toBe(false);
    expect(schema.safeParse({ request: "x", date: "2026-13-01" }).success).toBe(false);
  });
});
