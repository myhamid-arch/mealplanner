# R9: owner requests and spec r2 reread (architect, 2026-09-30)

Root gate R9 of `docs/build/GATES.md`. This review takes two inputs: the owner's requests from the build conversation (2026-09-25, 13:13–14:41 UTC) and spec r2. It checks each against the gate evidence on the integration branch at `4cf7495`. The contract inventory (`CONTRACT-INVENTORY.md`, 165 IDs) was verified by the architect earlier in R9; this file adds the owner-request view and records what changed since.

"Evidence" names the gates that prove each request. Root R1–R8 are listed as they ran at CP3 of root-verify (PR #30, 2026-09-30):
- R2–R8 passed 7/7 on a fresh `docker compose up`, once with `DATABASE_URL` unset and once with it set;
- node-1.1 R1 passed end to end, with the result cached and reused.

The final GATES.md run records its own EVIDENCE lines.

## The owner's requests

| # | Request (owner's words, condensed) | Spec | Evidence | Status |
|---|---|---|---|---|
| 1 | Each person gives daily macros and calories; every meal of the day meets them | PRD-10, PLN-4, SC-1 | SC-1: 68 of 68 targeted member-meals in tolerance, 0 flagged (node-1.2 N3; root R2 on a fresh stack) | Met |
| 2 | Tolerances: protein ±5 g, carbs "+-56", fat ±2 g; calories special; limit sat fat; prioritise soluble fibre | PLN-4, OQ-2, OQ-4, NUT-8 | `DEFAULT_TOLERANCE` 5/5/2 g, kcal ±50 per day (OQ-2); sat fat ≤ 6 % kcal and fibre 14 g/1,000 kcal, a quarter soluble (OQ-4, R-28): 1.2.2 G1–G2, 1.4.4 G1, 1.1.3 G4 | Met. **Interpretation:** "+-56" read as ±5 g (OQ-1 default, editable per member) |
| 3 | Meal slots: breakfast, lunch, dinner, snacks, packed school and work lunches, training meals; different days per person | PRD-6, PRD-7, PLN-3 | 1.2.2 G1 (training slots follow each member's schedule); 1.4.12 G1 (one tap: a packed lunch replaces lunch) | Met |
| 4 | Several family members with different targets; kids 18, 15 and 10 have none | PLN-7, US-1 | `solve.test.ts:342` untargeted plates = default × appetite × learned bias (node N4); F1 has 2 targeted adults and 3 untargeted children | Met |
| 5 | Priority: macros, then appeal (cuisines), then fewer ingredients; weights adjustable | PRD-1, PRD-2, US-9 | Planning weights in Settings and by agent (1.3.6 G2, eval `weekend-appeal`); SC-2's economy weight | Met |
| 6 | Reduce cooking, prep and waste: dishes that reuse the same ingredients | SC-2, PLN-9 | SC-2: distinct core ingredients cut by a median of 13.9 % (min 9.8 %) over seeds 1–10 (node-1.2 N3; root R3); mutation "economy ignored" fails SC-2 | Met |
| 7 | Same ingredients, different preparation (grilled vs fried) change macros and appeal | Variants, DM, US-8 | Dish variants with their own nutrition; 1.3.3 G1 (a better-rated sibling variant is proposed); 1.4.5 G1 | Met |
| 8 | Feedback on anything, like a review site: meals, components, frequency, quantities | FBK-1…9, US-7 | 1.4.5 G1 (quick and detailed review), 1.3.2 G1–G3, 1.3.7 G1 (practical tags → a packed-slot exclusion proposal, W-23) | Met |
| 9 | Built-in intelligence that learns from feedback | SC-3, FBK-5, FBK-7 | SC-3: two 1★ reviews lower the dish score (0 → −0.5) and produce one proposal; one review produces none (node-1.3 N3; root R4) | Met |
| 10 | Recipes provided (kitchen staff cook); AI writes recipes | REC-1…7, PRD-11 | 1.3.1 G1–G4 (generator), 1.3.7 G3 (admin-requested draft, save activates), cook sheet 1.2.3 G5 / 1.4.4 G1 | Met. **Interpretation (SPEC-Q-6):** a recipe card's example plates are shown for targeted attendees only |
| 11 | UAE (Abu Dhabi): kg and litres, locally available ingredients | PRD-8, NUT-7, NUT-9 | Catalogue with AE availability (1.1.3 G1); metric plates on the step grid (1.2.2 G2); SC-5 onboarding infers Asia/Dubai, AE, metric | Met; display rounding (NUT-9) has no gate |
| 12 | Web app plus mobile app for all family members | PRD-16, ARC-8, SC-5 | Installable PWA with offline Today (1.4.2 G2); SC-5 core flows at 390 px and 1280 px, axe 0 serious/critical (node-1.4 N3; root R6) | **Deviation:** the native app is phase B (OQ-3 default); v1 is the PWA |
| 13 | Customisable for any family; coarse by default, more detail where wanted | PRD-5, R2-DL | 1.4.3 G3 (auto values, per-value override, back to auto, level prompts); W-24 fixed | Met |
| 14 | Onboarding: at most 5 high-level questions; details inferred and adjustable | R2-ONB, SC-6, SC-7 | SC-6: exactly 5 questions, 0 required, a first plan answered or skipped; SC-7: 15 of 15 Adjust links resolve (root R7, R8); mutation "Adjust links broken" fails SC-7 | Met. PRD-4's "under 5 minutes" is not measured |
| 15 | Site administration: log in; add, remove, block users | R2-ADM-1…8 | 1.4.1 G4 (block revokes sessions, invites single-use, TOTP), 1.4.6 G1 (block, remove, last-admin protection), 1.1.2 G5 | Met; some R2-ADM clauses are manual-only (inventory) |
| 16 | Smart agent to administer by chat, with proposals | AGT, SC-4 | SC-4: every agent change logged and undone exactly (node-1.3 N3; root R5); live agent eval 29/29 twice; proposal accept in SC-5 | Met |
| 17 | A knowledge graph | KG-1…4 | 1.3.4 G1–G3 (sync, household scoping, similarity and substitution), 1.4.10 G2, 1.4.4 G3 | Met; KG-4.2 and KG-4.4 are partial |
| 18 | Engaging, colourful, kitchen-themed interface; mockups agreed first | PRD-18, R-21 | Mockups approved before the build; architect manual reviews in 1.4.x N5 | Met (manual) |
| 19 | Decisions: repeat gaps (OQ-8), SC-2 threshold, nut-free lunch boxes only (OQ-9), sat fat 6 % (OQ-4) | OQ-4, OQ-8, OQ-9 | node-1.2 N3 (0 repeats inside the gap); 1.2.6 G3–G4; 1.2.2 G2 | Met |

## Since the inventory review

- **W-23 (FBK-3 practical tags)** is implemented and proven by leaf 1.3.7 G1. DM-4, REC-6, PLN-3 and R2-DL-6 are proven by leaves 1.3.7 G2–G3 and 1.4.12 G1–G2 (R-82).
- **ARC-11 and the "fresh docker compose up" form of SC-1…SC-7** are proven by root R2–R8 at CP3 of root-verify. R2-ONB-2's "skip → defaults" is now proven by SC-6's skipped path.
- **Defects found and fixed during verification:**
  - W-24: meal-share "yours" inference;
  - W-25: 5 s test timeouts under load;
  - W-26: node N4 did not run leaf 1.4.12's spec.

## Known deviations and interpretations (for the owner's report)

1. Carbs "+-56" was read as ±5 g per meal. It is the OQ-1 default and editable per member.
2. Recipe-card example plates are for targeted attendees only (SPEC-Q-6). Untargeted portions are set when the day plan is solved.
3. ARC-4: 102 of 103 route handlers are thin. `app/api/auth/[...all]/route.ts:49-58` reads the 2FA magic-link policy from the database directly. This is left in place, because moving it would reopen the auth gates.
4. PRD-4's "under 5 minutes" is not measured; the 5-question count is.
5. The native mobile app is deferred to phase B (OQ-3 default); v1 is the installable PWA.
6. Clauses with partial or manual-only coverage are listed in `CONTRACT-INVENTORY.md` under "Partial coverage".
