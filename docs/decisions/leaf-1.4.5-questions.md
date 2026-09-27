# Leaf 1.4.5 — spec questions

Each question records the reading this leaf takes (the more conservative one) until the architect rules. `ARCHITECT QUESTION` marks the ones that needed an answer before the part they affect could be finished.

**Rulings (CP1, R-53 and its addendum):** SPEC-Q-1 option A; SPEC-Q-2, SPEC-Q-3 and SPEC-Q-14 granted; SPEC-Q-10 built now, the link edit in `apps/web/components/config/onboarding/onboarding-flow.tsx` (addendum `b09f7ed`); SPEC-Q-9's routes fixed for every leaf; SPEC-Q-4 … 8, 11 … 13 and 15 accepted. How each was built is noted under the question.

## SPEC-Q-1 (ARCHITECT QUESTION): building the `dish.create` ops for the recipe card's Save (R-46, REC-6)

R-46: "Save applies `dish.create` through `POST /change-sets` (1.4.5)." The `recipe` card's `dishes[]` carry the generator's draft as the worker returned it (`recipe-draft.ts`): `dish` (`GeneratedDish`: cuisine **keys**, method **keys**, ingredient **slugs**, `rawGramsPerBatch`, `isAbsorbedFat`, `assemblySteps`), `newIngredients` (per-100 g nutrition), `plates`, `reasons`, `candidate`. The ops need **ids** (`cuisineId`, `methodId`, `ingredientId`), a free slug, `ingredient.create` for each new ingredient, and the fixed choices `saveGeneratedDishes` makes (`stepG 5`, `referenceBatchCookedG 1000`, the "To assemble:" description suffix, `source: "ai"`, `nutritionSource: "ai_estimate"`, `nutritionConfidence: "low"`, slug grammars). That mapping lives in `packages/db/src/services/plans/generation.ts`, which the browser cannot import.

- **Option A (asked for):** one mapping, server-side. Extract the op construction of `saveGeneratedDishes` into an exported pure function (`generatedDishOps(survivors, catalog, takenSlugs)`) in `packages/db/src/services/plans/generation.ts`, and have `recipe-draft.ts` add `ops` (and the `summary`) per draft to the job result. The card's Save then posts exactly those ops. Needs single-entry edits in those two files (1.4.1's and 1.3.5's areas); 1.2.3/1.3.5 G-tests unaffected (same ops, same order).
- **Option B (the reading taken until ruled):** the chat builds the same ops in `apps/web/components/chat/recipe-ops.ts` from `GET /cuisines`, `GET /methods`, `GET /ingredients?q=<slug>` and `GET /dishes` (taken slugs), mirroring `saveGeneratedDishes` line for line, with a unit test that compares its output with `saveGeneratedDishes` on the same draft (the test needs SPEC-Q-14's OWNS). Risk: two copies can drift.

Discard drops the card locally (the draft was never saved; nothing to undo). Save shows an `applied_change`-style confirmation with Undo (`POST /change-sets/{id}/undo`).

**Built (option A):** `generatedDishOps` in `packages/db/src/services/plans/generation.ts` (with `householdDishSlugs`), used by `saveGeneratedDishes`; `recipe-draft.ts` adds `ops` and `summary` (`Add AI recipe "<name>"`) to each draft, slugs distinct across the drafts of one job. Save posts exactly those ops. One addition in the chat only: when two drafts of one card propose the same new ingredient and the first is saved, the second's `ingredient.create` for that slug is dropped and its dish points at the created ingredient (`remapOps`), so the second Save does not collide on the unique slug.

## SPEC-Q-2 (request): the desktop side panel needs one line in the shell layout (AGT-7, ChatSidePanel)

AGT-7: "Every admin page has the chat as a side panel on desktop (≥ 1024 px), toggled by a floating button." 1.4.2's `AppShellFrame` already takes a `panel` prop ("the chat side panel, 1.4.5"), but `apps/web/app/(shell)/layout.tsx` does not pass one, and it is not in this leaf's OWNS.

Request: a single-entry edit to `apps/web/app/(shell)/layout.tsx`: `panel={viewer !== null && hasAssistant(viewer.role) ? <ChatPanel /> : undefined}` with `ChatPanel` from `apps/web/components/chat`. The component is self-contained (collapsed: a floating Assistant button at bottom right; open: the 460 px panel of the mockup, "Looking at: <page>" from the route and the page's `<h1>`, "Full screen" → `/chat/<id>`). It never renders on `/chat` itself. 1.4.2 G1/G2 must still pass (shown at CP2). Until granted, the panel is built and tested on the chat route's own layout only and listed as a deviation.

## SPEC-Q-3 (ARCHITECT QUESTION): no read endpoint for portion biases (FBK-5, FBK-9, Insights mockup)

FBK-9: the Insights screen shows "portion biases"; the mockup: "Portions for Adam — Protein × 1.1 · Carbs × 1.0 · Veg × 0.9 … History". `portion_bias` rows are written by learning (`portion_bias.set`, R-24) but no endpoint reads them. Proposed (1.4.1's area; this leaf builds only the UI):

```
GET /api/v1/portion-biases?memberId=<id>        roles: admin; member (own member only)
200 { biases: Array<{ memberId: Id, componentRole: ComponentRole, factor: number, updatedAt: Timestamp }> }
```

Reading until ruled: the portions section is not rendered, and this is listed as a deviation. "History" links to `/changelog`.

**Built (granted):** `portion_bias` has no timestamp column, so the DTO is `{ memberId, componentRole, factor }` (no `updatedAt`). A member asking for another member gets 403; a member without a linked member gets an empty list; kitchen is refused by role. Targeted members' portions are fixed by targets (FBK-5), so Insights says so instead of showing factors.

## SPEC-Q-4: `macro_table` has no producer (AGT-7)

`MacroTableCard { date, rows: Json[] }` is declared in `packages/ai/src/agent/cards.ts`, but no tool or event emits it, and `rows` has no shape. AGT-7: "member × slot targets vs actuals". Reading: a row is `{ member: string, slot: string, target: MacroSet | null, actual: MacroSet | null, fitStatus?: FitStatus }` (the fields of `PlateDto` the agent's `get_plan` already returns). The card renders a member × slot grid with target, actual and a fit badge (text + icon, UX-6); a row that does not match is shown as "—" rather than dropped. G3 renders it from a recorded fixture of that shape. When a tool starts emitting it, its shape should be fixed in `cards.ts`.

## SPEC-Q-5: proposal "Edit (opens the same ops in a form)" (AGT-7)

`POST /proposals/{id}/accept` takes no body, so an edited proposal cannot be accepted as edited. Reading: Edit opens the proposal's ops in a form listing each op's scalar payload fields (numbers, text, yes/no; ids and nested values shown read-only), with the `describe` preview refreshed through `POST /change-sets/preview`. "Apply edited" applies the edited ops with `POST /change-sets` (summary = the proposal title + " (edited)") and then rejects the proposal with the note "Edited and applied" — so it is not proposed again unchanged and the decision history shows both. The applied change gets Undo like any other.

## SPEC-Q-6: review tags that are only in the mockups (FBK-3, R2-UX-4)

QuickRatePhone's chips are all FBK-3 tags (`loved_it`, `too_much`, `too_little`, `more_often`, `too_spicy`, `bland`). ReviewComposePhone's per-part chips also show "Crispy", "Too sour" and "Not for me". FBK-3: "Tags are extensible per household (custom tags with no signal mapping are still stored and shown)". Reading: they are stored as custom tags `crispy`, `too_sour`, `not_for_me` (no signal). The part's summary label ("Loved", "Too much", "Didn't eat") is derived from its tags (`not_for_me` → "Didn't eat" is **not** assumed; it shows "Not for me"), not stored.

Detailed review writes: one `plan_meal` review (rating, frequency tag, comment, `onBehalfOfMemberId`), and one `component` review per part the reviewer tagged (target = component id, `planMealId` set, so learning finds the eaten variant). Parts left untouched write nothing.

## SPEC-Q-7: "evidence count" on the Insights tables (FBK-9)

`PreferenceDto` has `evidenceWeight` (Σw of FBK-4), not a review count, and no endpoint maps a preference to its reviews. Reading: the table shows the weight labelled "evidence" (e.g. "evidence 2.4"), and its link opens `/reviews?member=<id>` (that member's feed). It does not claim "N reviews".

## SPEC-Q-8: "Learned: Zayd's rice × 0.9" and names on reactions (ReviewsFeed)

No endpoint links a review to the learning change set it caused, and `ReviewDto.reactions` has counts, not names. Reading: the feed shows reaction counts ("Agree · 2"), no names, and no "Learned" pill (listed as deviations). The Assistant reply in the mockup is shown for admins as a note under a review when a pending or decided proposal's `evidence` lists that review id: "I've proposed: <title>" with "Review proposal" → `/insights`.

## SPEC-Q-9: route shapes other leaves link to

- Quick rating: `/reviews/rate?planMealId=<id>` (the bottom sheet; "Say more…" → the detailed review).
- Detailed review: `/reviews/new?planMealId=<id>[&for=<memberId>]`, and `/reviews/new?targetType=<t>&targetId=<id>` for any other reviewable object (dish, ingredient, …; FBK-2). This matches 1.4.4 SPEC-Q-9's `/reviews/new?planMealId=`.
- Chat: `/chat?prompt=<text>` prefills the composer and does not send (1.4.3 SPEC-Q-16, architect note). 1.4.4 SPEC-Q-9 proposed `/chat?draft=`; this leaf reads only `prompt` and asks that 1.4.4 use it.
- Conversations: `/chat` opens the most recent conversation (or an empty new one); `/chat/<conversationId>` a given one; `/chat?new=<anything>` an empty one ("New conversation"; each press uses a fresh value so the screen starts afresh).

## SPEC-Q-10: ChatOnboarding (R2-ONB-5) — where it lives and how it converses

`(setup)/onboarding/**` is 1.4.3's; this leaf owns `(app)/chat/**`. Reading: `/chat/setup`. The conversational path does not use the agent model (no endpoint parses onboarding free text yet; the model-backed parse is W-5): the assistant's side is scripted in the page and asks the five R2-ONB-1 questions in turn, each skippable; replies are parsed with 1.4.3's deterministic parsers (`parsePeople`, `parseTargets`, `parseNeverEat`, cuisine matching) into `OnboardingAnswers`, shown for confirmation, and `inferSetup` builds the ops; "Create all & plan tomorrow" applies them as one change set (`POST /change-sets`) then `POST /plans/generate` for tomorrow, the same ending as 1.4.3's review. 1.4.3's "Just tell me" link currently points to `/chat?prompt=Set up my household: `; it should point to `/chat/setup`. Built after 1.4.3 merges (architect note); if it has not merged by CP2, this is stated at CP2.

**Built:** questions 1, 2 and 5 are typed answers (question 2 in one message: each person's numbers after their name, "I"/"me" meaning the admin; `targetsByPerson`); questions 3 and 4 are tap cards inside the conversation (packed school lunch, work lunch, who trains with days and morning/evening, snacks; cuisine stickers), because 1.4.3 has no deterministic parser for a free-text week. The SETUP PROPOSAL card shows the people table, Shared / Individual / Likes chips and every explanation; after saving, each explanation links to where it is adjusted (SC-7), and tomorrow is planned.

## SPEC-Q-11: conversation list: auto titles, search, the Updates badge (AGT-7)

- Auto titles: a conversation is created on the first send with `title` = the first message's first line, cut to 60 characters at a word boundary (`POST /conversations` takes the title; there is no rename endpoint).
- Search: client-side filter over the titles of `GET /conversations` (no search endpoint; message text is not searched).
- Badge: the count of `event` messages newer than the conversation's last view on this device (kept in `localStorage`, per browser). No read state exists server-side.

## SPEC-Q-12: suggestion chips "based on state" (AGT-7)

Reading: at most four, computed from the data the page already has: "Review N proposals" when proposals are pending (`GET /proposals?status=pending`), "Plan tomorrow" when tomorrow has no plan day (`GET /plans?from=&to=`), "What have you learned this week?" (FBK-7 on demand), and on the side panel a sentence about the page ("Why is this meal off target?" on a plan meal, …). Tapping a chip fills the composer; it does not send.

## SPEC-Q-13: exclusion wording in proposal and applied-change cards (R-34, R-36)

Every exclusion filters, whatever `hard`; `hard` only protects it from being relaxed without the admin. Reading: the diff shows `hard` as "Protected from automatic change: yes/no", never "may be served", and an `exclusion.add` title reads "Never serve <name> to <who>" for every `hard`. Ingredient keys are slugs (R-36); the card shows the ingredient's name when `GET /ingredients?q=<slug>` finds it, else the slug.

## SPEC-Q-14 (request): OWNS for unit tests and gate fixtures

The leaf's OWNS has one test file (`apps/web/e2e/chat.spec.ts`). Requested:

- `apps/web/test/chat/**` — vitest unit tests for the Markdown renderer, the card parsers, the SSE turn reducer and (Option B) the recipe-op mapping;
- `apps/web/e2e/chat/**` — gate fixtures: the recorded tool results for G3 and the scripted model stub that the verify script preloads into the web server for G1/G3 (ADR-1). No production code reads them.

Reading until granted: fixtures are generated by `scripts/verify/leaf-1.4.5.mjs` into the gate's temp directory, and unit-level checks run inside `chat.spec.ts`.

## SPEC-Q-15: "Reviewing for" and the feed's "Kitchen" filter (FBK-2, ReviewsFeed)

- Reviewing for: admins may pick any member; a member sees their own member and, when the household allows members to review for younger siblings, members younger than them (`GET /households/current`, `GET /members`); the server enforces it either way.
- The "Kitchen" chip in "Who" filters reviews whose tags are all kitchen tags (FBK-3 Kitchen group), since `ReviewDto` has no author role.
- "About" filters by target type: Dishes = dish, plan_meal, plate; Parts of dishes = component, variant; Ingredients = ingredient; Portions = reviews with a quantity tag; How often = reviews with a frequency tag; Whole days = plan_day. "Low ratings only" = rating ≤ 2; "Unanswered" = no reply (`GET /reviews?parentId=`).

## SPEC-Q-16: the chat as a full-screen sheet on phones

AGT-7: "On mobile it is a full-screen sheet." The shell (1.4.2) draws the tab bar and the floating Assistant button on every page, which would cover the composer. Reading: below 1024 px the chat screen is a fixed full-screen layer over the shell (ChatPhoneDigest / ChatPhoneRecipe: a purple header with Back and the conversation's title, no tab bar), with a "Conversations" button for the list. At ≥ 1024 px it sits beside the rail (ChatDesktop).

## SPEC-Q-17: steps after a turn, and card order

AGT-7: activity chips "collapse into a Details disclosure". Reading: while the turn streams, each tool is a chip with the server's label ("Checking the plan…"); when it ends they fold into "Details · N steps" (a failed tool is marked "(failed)"). ChatDesktop's permanent past-tense chips are drawn this way (listed as a deviation). Text and cards appear in the order the loop stored them (a card can come before the text of the next model call).

## SPEC-Q-18: what a stored proposal card shows later

A `proposal` card is stored as `pending`. Reading: the chat reads the proposals and the change log, so a card whose proposal was since accepted shows "Accepted" with Undo, one whose change set was undone "Accepted, then undone", one rejected its reason, one expired or superseded says so, instead of offering Accept again. The digest card does the same per proposal.
