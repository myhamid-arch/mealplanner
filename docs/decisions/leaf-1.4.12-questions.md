# leaf-1.4.12 spec questions

## SPEC-Q-1: "applies the change at that section's level" (R2-DL-6, G2)
R2-DL-6 says "tell the assistant" "applies the change at the right level"; the gate says "at that
section's level". Reading taken (the more testable one): the recorded turn writes the op kind that
the section's own controls write for the value at the level the section shows, and afterwards the
section, still at that level (its `detail_level` row unchanged), shows the new value, and the stored
state read through the API matches:
- Daily targets at **Basic**: `target.set` on the member's default profile; the section shows the
  new kcal.
- Meals at **Detailed**: `distribution.set` with one meal's share set and the others rebalanced to
  100 % (the rule R2-DL-4 uses); the section shows that share tagged `yours`.
- Tastes at **Detailed**: `preference.set` of a cuisine for that member; the section's cuisine
  choices show it as the member's own.

## SPEC-Q-2: the Tastes prompt does not name the section (blocks G2)
The three detail-level sections on a member's page prefill:
- Daily targets: `Change <name>'s daily targets: ` (names member and section);
- Meals: `Change how <name>'s day is split across meals: ` (names member and section);
- Tastes: `<name> likes ` (`apps/web/components/config/tastes-section.tsx:188`): names the member,
  not the section.

G2 requires "a request naming that member and section". On the strict reading the Tastes section
fails G2. Proposed patch (one line, outside OWNS, 1.4.3's file):
`<TellAssistant prompt={`Change ${member.displayName}'s tastes: `} />`.
The test takes each section's name from its heading (`Daily targets`, `Meals`, `Tastes`) and requires
the prefilled request to contain the member's name and that name's last word (`targets`, `meals`,
`tastes`), case-insensitive.

## SPEC-Q-3: which sections are "every detail-level section on a member's page" (G2)
Reading taken: every section of `/family/<memberId>` that carries the R2-DL segmented control
(`[data-detail-control]`). For a targeted member who trains these are Daily targets, Meals and
Tastes. Training (no level control, but its own "Tell the assistant") and Allergies & never-serve
(neither) are outside the check. The test fails if fewer than these three sections carry the control,
so the check cannot pass on an empty set.

## SPEC-Q-4: "those days" (PLN-3, G1)
Reading taken: the weekdays on which the member attends the packed slot. After the tap, the stored
schedule has `attends = false` for the member's lunch on exactly those weekdays, and the member's
other lunch days are unchanged. The generated plan is checked over one week: on each packed day the
member has a packed plate and no lunch plate; on the other days the member keeps a lunch plate.

## SPEC-Q-5: a meal split set to 40 % shows every share as `yours` (R2-DL-4; found by G2)
Found while building G2, and raised on the PR as an ARCHITECT QUESTION with a proposed patch.
- `meal_distribution.share` is `numeric(10,3)` (`packages/db/src/migrations/0001_schema.sql:199`;
  `num()` in `packages/db/src/schema/columns.ts:12`).
- `rebalance()` rounds to 4 decimals and `inferYours()` treats two ratios as the same within 0.4 %
  (`apps/web/components/detail-level/logic.ts:29`, `:62`).
- For a member with breakfast, lunch, dinner and snack, lunch set to 40 % gives siblings 0.2308,
  0.2769 and 0.0923. They are stored as 0.231, 0.277 and 0.092. The snack's rounding error (0.43 %)
  is over the tolerance, so `inferYours()` finds no majority group and returns every key. The Meals
  section then shows all four shares as "Yours · back to auto". This was observed in G2 at 390 and
  1280 px, and the section's own "set lunch to 40 %" writes the same values.

Reading taken: this leaf does not change 1.4.3's logic (outside OWNS). The recorded turn sets lunch
to 35 %, where every share is exact in the column (0.25, 0.30, 0.10, 0.35). G2 therefore tests
R2-DL-6 and not this rounding defect.
