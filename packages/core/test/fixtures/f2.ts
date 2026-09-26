// F2 — minimal: one targeted adult, breakfast/lunch/dinner (11-build-plan §2, BLD-2).
import type { FixtureInput } from "../../src/types/index.js";

export const F2: FixtureInput = {
  id: "F2",
  household: { name: "Household F2" },
  users: [{ key: "solo", email: "solo@f2.example", name: "Solo", role: "admin", member: "solo" }],
  members: [
    {
      key: "solo",
      displayName: "Solo",
      color: "sea",
      birthYear: 1990,
      appetite: "medium",
      targets: { default: { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 } },
    },
  ],
  slots: { active: ["breakfast", "lunch", "dinner"] },
  cuisines: { liked: [], disliked: [] },
};
