# 06 — Feedback and learning

Feedback works like a review site. Anything can be reviewed, reviews carry structured signals plus free text, and people can reply and react. The learning system turns reviews into preference and portion changes. Low-risk signals update learned scores automatically. Changes to settings, recipes or hard rules become **proposals** that the admin accepts or rejects (FBK-1).

## 1. What can be reviewed (FBK-2)

| Target | Example |
|---|---|
| dish | "Chicken shawarma bowl 4★ — great, make it more often" |
| component | "The garlic sauce was too heavy" |
| variant | "Breaded-fried hammour 5★" / "Grilled hammour 2★, dry" |
| ingredient | "I don't like freekeh" |
| plate / plan_meal | "Too much rice on my plate" |
| plan_day | "Too much food today" |
| cuisine / method | "More Italian please", "Less deep-fried" |

A review has: author (user), on-behalf-of member (defaults to the author's linked member; admins may choose any member), optional 1–5 rating, tags, comment, optional parent (reply), and reactions (agree, disagree, helpful). Reviews are editable by their author for 24 h. Edits are kept.

## 2. Tag vocabulary (FBK-3)

Each tag maps to a structured signal:

| Group | Tags | Signal |
|---|---|---|
| Taste | `loved_it`, `tasty`, `bland`, `too_salty`, `too_spicy`, `not_spicy_enough`, `too_sweet`, `too_oily`, `dry`, `soggy`, `overcooked`, `undercooked` | Appeal on the target. Quality notes (`too_salty` …) attach to the dish/variant as **recipe notes**, which feed a recipe-revision proposal. |
| Quantity | `too_much`, `too_little`, `just_right`, `still_hungry` | Portion signal for the member (§4) |
| Frequency | `more_often`, `less_often`, `never_again` | frequency_rule / hard preference (§5) |
| Practical | `hard_to_pack`, `went_soggy_in_box`, `cold_is_bad`, `took_too_long` | Slot suitability flags on the dish |
| Kitchen | `ingredient_unavailable`, `recipe_unclear`, `quantity_wrong` | Recipe-revision or catalogue proposals |

Tags are extensible per household (custom tags with no signal mapping are still stored and shown).

## 3. Preference model (FBK-4)

The score is `score ∈ [−1, 1]` per (member | household, entity_type, entity_key). Stored as the weighted sum and the total weight: `score = Σ(wᵢ·sᵢ) / (Σwᵢ + k)`, with shrinkage `k = 2`. This means a single review moves the score at most 1/3 of the way.

**Signals from a review:** `s = (rating − 3) / 2`. Tags add: `loved_it +1`, `tasty +0.5`, the negative taste tags −0.5 each (capped at −1 total), and `never_again` sets `hard = never` via a proposal, not directly (§6).

**Propagation from a review on target X** (weights `w`):

| X reviewed | Updates |
|---|---|
| dish | dish 1.0; cuisine 0.3; each eaten variant's method 0.3; each core ingredient of the eaten variants 0.15 / √n |
| variant | variant (as `dish:<id>#<variantId>`) 1.0; method 0.5; dish 0.3 |
| component | component's variant 0.8; its core ingredients 0.2 / √n |
| ingredient / cuisine / method | that entity 1.0 |

"Eaten variants" come from the review's `plan_meal`/`plate` context. If the review has none, all default variants are used.

**Appeal evaluation** for member `m` and plate `p` (used by PLN-9):

```
a = clamp( 0.35·dishScore + 0.20·mean(variantScores) + 0.15·cuisineScore
         + 0.10·mean(methodScores) + 0.15·ingredientTerm + 0.05·kgSimilarityTerm , −1, 1)
ingredientTerm = mean(ingredient scores) − 0.5·max(0, −min(ingredient scores))   // one disliked ingredient drags hard
```

- Each score is the member-level value where it exists, otherwise the household-level value, otherwise 0.
- Admin-set (`explicit`, `locked`) preferences override learned ones for the same key.
- `kgSimilarityTerm` comes from [08-knowledge-graph.md](08-knowledge-graph.md) §4: the similarity-weighted mean of the member's scores on the dishes nearest this one. It gives new dishes a sensible prior.
- The weights are constants in v1 (`learning/config.ts`).

**Cold start (coarse setup).** The admin picks liked cuisines (household-level, +0.5) and disliked ones (−0.5), and optionally per member. Members with logins get a 60-second "taste swipe": 20 dish and ingredient cards (like / neutral / dislike) that seed explicit preferences.

## 4. Portions for untargeted members (FBK-5)

`learned_role_bias[member][component_role]` starts at 1.0. On `too_much` it is multiplied by 0.9 and on `too_little` / `still_hungry` by 1.1, bounded to [0.6, 1.6]. It updates automatically, because it is low risk and reversible, and the change is logged as a `learning` change set. For **targeted** members, quantity feedback never changes grams, because the targets fix them. Instead it becomes an insight: for example, a proposal to shift calorie share between slots, or to prefer higher-volume, lower-density variants (e.g. more vegetable component) for that member. That second option is implemented as a member-level preference boost for `component_role:vegetable`, which the solver uses via `λ_appeal`.

## 5. Frequency (FBK-6)

- `more_often` on a dish: after 2 such signals in 30 days, a proposal to set `min_gap_days = 3` for that dish (default 6).
- `less_often`: after 2 signals, a proposal to set `min_gap_days = 14`.
- `never_again`: an immediate proposal to set `hard = never` for that member on that dish.
- The planner also computes observed frequency. The insights engine flags any dish served more than 2× in 7 days that has a mean rating below 3.

## 6. Insights engine (FBK-7)

It runs as a background job:
- after every 10 unprocessed reviews, or
- nightly at 02:00 household time, or
- on demand ("What have you learned this week?" in chat).

Two stages:

1. **Deterministic rules** produce candidate proposals. Every rule is unit-tested. Examples:
   - A variant has mean rating ≤ 2.5 over at least 3 reviews from the same member → propose `set_preference(member, variant, −0.8, locked)`, or a switch to a better-rated sibling variant.
   - An ingredient appears in ≥ 3 negative component reviews from the same member → propose an exclusion (`reason: dislike`) for that member.
   - A recipe note tag repeated ≥ 2 times → propose `revise_recipe`, which triggers a regenerate-variant job.
   - A plate is infeasible or a flexible miss on ≥ 3 days in 14 → propose target distribution changes or dish swaps.
   - An AI-estimated ingredient is used in ≥ 3 planned meals → propose verifying its nutrition.
2. **LLM synthesis** (Claude, structured output). Input: the rule candidates, the unprocessed review texts since the last run (pseudonymised), the current weights and settings summary, and the last 20 rejected proposals with their decision notes. Output: a de-duplicated, prioritised list of proposals (each one a typed `kind` + `payload` from [07-agent.md](07-agent.md) §4) with rationale and evidence review ids. It MAY add proposals the rules missed, for example free-text comments like "Omar said he's bored of rice at lunch". It MUST NOT emit kinds outside the allowed set, and every proposal is validated with Zod before it is stored.

**Guardrails (FBK-8).**
- **Fingerprint.** `kind` plus the normalised payload target. A proposal whose fingerprint matches one rejected in the last 30 days is suppressed unless new evidence has doubled.
- **Budget.** At most 5 pending proposals per household. Lower-priority ones wait in the queue.
- **Protected.** No proposal may remove or relax an allergy exclusion, or change tolerances to be looser than the admin set, unless the admin explicitly asked in chat.
- **Expiry.** Pending proposals expire after 14 days.

Results are posted to the admin's current conversation as an **insight message** (see [07-agent.md](07-agent.md) §5) and listed on the Insights screen.

## 7. What the admin sees (FBK-9)

- **Insights screen.** A "What I've learned" panel per member: top liked and disliked dishes, ingredients, cuisines and methods, each with score, evidence count and a link to the reviews. It also has portion biases, pending proposals, and a decision history. Every learned value has Lock, Reset and Edit controls.
- **Accepting a proposal** applies a change set. **Rejecting** asks for an optional one-line reason, which is fed back to the insights engine.
