# leaf-1.4.7 spec questions

Each question states the reading this leaf builds on unless the architect rules otherwise at CP1.

## SPEC-Q-1: `ai_generation.purpose` for the onboarding parse (DM-7)
REC-2/DM-7: every Claude call writes an `ai_generation` row. The `ai_purpose` enum (02 §7, migration 0001) is `recipe | insights | chat | comment_extraction`; none describes an onboarding parse.
- Reading proposed: add the value `onboarding_parse` in migration **0006** (`ALTER TYPE "ai_purpose" ADD VALUE 'onboarding_parse'`) with a single-entry edit to `AI_PURPOSES` in `packages/core/src/types/enums.ts:228`, and 02 §7 amended by the architect. Every parse call (success, refusal, schema failure, API error) writes one row; `request_summary` holds the field, text length and model, never the text or a credential.
- If refused: the parse writes no row, and DM-7 is a listed deviation. Not recording under an unrelated purpose (`chat`) keeps the diagnostics page honest.

## SPEC-Q-2: what the model sees
The people line, target numbers and never-eat text are the admin's own words about named people. REC-3 pseudonymisation covers recipe generation and insights; AGT-3 sends names in chat.
- Reading: the text is sent as typed (names are what question 1 parses, and question 5 attributes rules to them), plus, for `never_eat`, the people names from question 1. No other household data, no catalogue. Only the admin can call the route.

## SPEC-Q-3: "a model answer that fails the schema is refused, not repaired"
- Reading: the structured-output schema (Zod, strict) is checked by 1.3.1's client (`parse_null` on mismatch). The route then applies the same semantic checks the deterministic parsers enforce and refuses on any failure, with no retry and no partial use: `people` — names unique, ages 0–120; `targets` — kcal 500–6000, macros ≥ 0, kcal within 12 % of 4P + 4C + 9F (the check `parseTargets` applies); `never_eat` — `who` is one of the given names or `everyone`, `reason` from `EXCLUSION_REASONS`. A refusal is `502` problem `model_output_invalid`, and the page keeps the deterministic parse.
- Refusal (`stop_reason: refusal`), `max_tokens` and API errors are `502` with their typed code; no credential is `503`.

## SPEC-Q-4: effort and model
- Reading: model from `ANTHROPIC_MODEL` (default 1.3.1's `DEFAULT_MODEL`), adaptive thinking, `fallbacks: "default"` with the fallback beta, all through 1.3.1's `createClaudeClient`. Effort `low`, as ARC-7 sets for the comparable extraction call (`reviews.extract`): the task is a short structured parse.

## SPEC-Q-5: how the page shows the model parse (R2-ONB-3 "shown for confirmation")
1.4.3's page already parses deterministically on every keystroke and shows "Read as …" under each answer.
- Reading: when the admin stops typing (800 ms) in a free-text answer, the page calls the parse route. When the model's reading differs from the deterministic one, a confirmation block appears under the answer: "The assistant read this as …" with **Use this reading** and **Keep mine**. Nothing changes until the admin taps Use this reading; editing the text discards the model reading. On 503 (no credential) or any error the block never appears and the deterministic parse stays (G1). SC-6 is unaffected: the confirmation is optional, never a required input.

## SPEC-Q-6: preview semantics (UX-4, G2)
`POST /api/v1/plans/preview`, admin, body `{ dates: IsoDate[1..7], weights: Partial<Weights>, seed = 1 }` → 202 `JobRef`; the `plans.preview` job's `done` result:
`{ current: Metrics, proposed: Metrics, changes: Change[], currentSource: "saved" | "computed" }`, `Metrics = { distinctIngredients, inTolerancePct, meals }`, `Change = { date, slotKey, memberId | null, before: { dishId, dishName, variant? }, after: { … } }`.
- **Proposed**: the planner run on exactly the input `plan.generate` would load after `weights.set` with those weights (same loader, same seed, the weights row overlaid the way the op applies it). No AI recipe generation during a preview (a preview writes no dishes); generation requests are counted in the result instead. G2 compares it with a real `weights.set` + `plan.generate` of the same dates and seed, meal by meal and plate by plate.
- **Current**: the saved plan of those dates when every date has one; otherwise a planner run with the current weights and the same seed (`currentSource: "computed"`), since "if you save" compares against what would happen anyway.
- **Distinct ingredients**: distinct ingredient ids over all meals of the dates (the planner's economy count). **In tolerance**: plates of targeted members with `fitStatus = in_tolerance` / plates of targeted members. **Changes**: a meal whose dish differs, or, with the same dish, a member whose variant choice differs ("fried eggs → poached for Sara").
- The job writes nothing but its own job row and events (G2 compares row counts of every plan table and `change_set`).

## SPEC-Q-7: the panel on Planning balance
- Reading: the "Next week, if you save" panel sits beside Fine-tune at Detailed and Expert (as in the mockup) and previews the draft weights for the next 7 days (tomorrow onwards, household time zone), re-run 1 s after the sliders stop. **Save & replan** applies `weights.set` and then `POST /plans/generate` for the same dates and seed; **Reset** restores the saved weights. These replace Fine-tune's own Save/Reset buttons and the "Replan next week" row at those levels. At Basic, presets still apply on tap and the "Replan next week" row stays.

## SPEC-Q-8: which follow-ups exist (R2-ONB-6)
R2-ONB-6 gives examples, not a list. The engine is a pure function of the saved configuration (the five answers are not stored after onboarding; what they set is), `proposeFollowups(config) → Followup[]`, in a fixed order:
1. `school_nut_free` — open when a `packed_school_lunch` schedule exists and no exclusion covering `contains_nuts` applies to every school child (household-level or per child). **Yes, nut-free** adds `exclusion.add { kind: dietary_flag, key: contains_nuts, reason: other, hard: true }` for each school child. Exclusions have no slot scope (02 §6), so this keeps nuts out of those children's meals everywhere, and the card says so: "Is the school nut-free? I'll keep nuts out of Layla, Adam and Zayd's meals." (copy deviation from "out of the lunch boxes"). **No** records the answer only. ARCHITECT QUESTION: if a slot-scoped exclusion is wanted, it needs a column and planner support outside this leaf.
2. `dinner_time` — open while the dinner slot's `default_time` is still the PLN-2 default (no one has set it). "Dinner at 19:30 — is that about right?" with one-tap choices **Yes**, **19:00**, **20:00**, **20:30** (`slot.update { defaultTime }`); other times live in Meals & schedule (linked). One item for dinner, the meal the whole family shares, not one per slot.
3. `training_kcal:<memberId>` — one per targeted member with a training schedule and no training-day target profile. **Stay the same** records the answer. **Go up** records it and links to the member's training section to enter training-day numbers; no numbers are invented (as 1.4.3 SPEC-Q-3 did for the carb bias).
- F1's five answers therefore give exactly `[school_nut_free, dinner_time, training_kcal:<Adult B>]` (Adult A's answer carries training-day numbers). Negative controls: Adult A's training question, and the nut question once an `everyone` nut rule exists, are never proposed.

## SPEC-Q-9: one per day, dismissal (R2-ONB-6 "at most one per day … dismissible")
- Reading: today's card is the first open item, unless an item was answered or dismissed today (household time zone), in which case there is no card until tomorrow. **Not sure · Ask me later** (the mockup's dismiss) marks the item dismissed today; it returns after every never-offered item, oldest dismissal first. Answers are final (the setting itself stays editable on its screen). "QUICK QUESTION · n OF m" counts resolved-plus-current over all proposed items.

## SPEC-Q-10: the "Getting set up" checklist
Derived from existing data, nothing stored for it: **Family added** (≥ 1 active member), **First plan made** (any plan day), **Kitchen invited** (a kitchen login or an open kitchen invite), **Rate your first 3 meals** (≥ 3 reviews in the household), **Invite the family** (a member-role login or an open member invite), **Answer n optional questions** (every proposed follow-up answered; omitted when none is proposed). Header "Monday · day N": N = days since the household was created + 1, household time zone.

## SPEC-Q-11: follow-up storage (R-9 procedure; migration 0006)
- Reading: table `setup_followup` (id uuid pk, household_id, key text, status `answered | dismissed`, choice text null, change_set_id uuid null, resolved_by_user_id, resolved_at timestamptz; unique (household_id, key)). Like `detail_level` (R-24), it is UI state written directly through its repository, outside DM-6; an answer that changes configuration applies its ops as one change set (actor user, source ui) and stores that change set's id. Requires `packages/db/src/schema/setup.ts` and the single-entry edits listed in the PR.

## SPEC-Q-12: live-model accuracy
The §5 text of G1 says live accuracy is a credential handoff (ABANDON with the owner command), but the ledger has no gate for it, and G1 itself (recorded responses) is achievable. ARCHITECT QUESTION: add a gate (e.g. G6 "live parse of the F1 answers matches the deterministic parse") that this leaf then abandons with the owner command, or keep the handoff in the PR only. Until ruled, the owner command is in the PR and `node scripts/verify/leaf-1.4.7.mjs --live` implements it (it refuses to run without a credential).
