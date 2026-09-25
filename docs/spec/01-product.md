# 01 — Product

## 1. Problem

A household has several eaters. Some have daily macro and calorie targets that differ from each other, and those targets differ again on their own training days. Others (children) have no targets. Everyone has different tastes. Kitchen staff cook, so cooking effort and batch prep are **not** constraints. The household wants:

1. Every targeted member's macros hit **at every meal**, within tight tolerances.
2. Food that appeals to everyone, across a range of cuisines (American, British, Italian, Middle Eastern, Indian, …).
3. Few distinct ingredients: dishes that share ingredients, with appeal and macros varied mainly through **preparation method** and portioning rather than by introducing new ingredients.
4. Recipes written for the kitchen, with exact quantities.
5. A feedback loop that makes the plans better over time.

The product is multi-tenant. It MUST NOT be built around one family's settings. The owner's household is the reference test case.

## 2. Objective priority (PRD-1)

Default order, highest first:

1. **Macro precision.** Targeted members' per-meal protein, carbohydrate, fat and calories fall within tolerance. Saturated fat is limited. Soluble fibre is prioritised.
2. **Appeal.** Cuisine preferences, per-member likes and dislikes, and learned ratings.
3. **Ingredient economy.** Minimise distinct ingredients across the planning window. Reuse the same ingredients across dishes and slots. Prefer a new preparation method over a new ingredient.

PRD-2: These are **weights**, not a fixed lexicographic order. The admin can change them at any time (sliders in Settings, or by asking the agent). Macro tolerances remain hard constraints unless the admin switches a member to "flexible" mode (see [04-planner.md](04-planner.md) §5).

## 3. Users and roles (PRD-3)

| Role | Can do |
|---|---|
| Admin (≥1 per household) | Everything: household setup, members, targets, slots, schedules, weights, recipes, plans. Talks to the agent. Accepts or rejects proposals. Undoes applied changes. |
| Member with login | Views their own plan and plates, the household plan, and recipes. Writes reviews and comments. Edits their own taste preferences. Cannot change targets, weights or settings unless promoted to admin. |
| Member without login | Exists as an eater. Admins can record feedback on their behalf. |
| Kitchen (optional login) | Read-only cook sheets and recipes. Can mark meals cooked and flag issues (e.g. "ingredient unavailable"). |

The owner's household has 3 children (ages 18, 15, 10) with no targets, plus targeted adults. Children MAY have logins so they can leave feedback.

## 4. In scope (v1)

- PRD-4 Household onboarding at coarse granularity: members, optional targets, slots, cuisines. The admin can go from signup to a first generated day plan in under 5 minutes using defaults.
- PRD-5 Progressive granularity. Every configurable area starts coarse and lets the admin add detail where they want it (see [09-ux.md](09-ux.md) §2).
- PRD-6 Meal slots, configurable per household and scheduled per member per weekday: breakfast, lunch, dinner, snacks, packed school lunch, packed work lunch, pre-workout, post-workout, and custom slots.
- PRD-7 Training days per member (different members, different days), which add pre- and post-workout slots and optionally switch to training-day targets.
- PRD-8 AI-authored recipes (Claude), expressed in the household's units (metric: g, kg, ml, L) and limited to ingredients commonly available in the household's locale. The reference locale is Abu Dhabi, UAE.
- PRD-9 Day and week plans. For every shared slot: one dish, with a chosen preparation variant and cooked grams per component per member.
- PRD-10 Per-meal macro fit for every targeted member, verified numerically by a deterministic solver. The LLM never does the macro arithmetic.
- PRD-11 Cook sheet per day for kitchen staff: raw quantities to prepare, per-variant method and steps, and a plating table.
- PRD-12 Review-site style feedback on anything: dishes, components, ingredients, preparation variants, portion quantities, frequency, whole days. Ratings, tags, comments, threaded replies.
- PRD-13 Learning. Feedback updates preference models automatically, and an insights engine produces proposals.
- PRD-14 Conversational admin agent, chat-style (ChatGPT/Claude-like). The admin can manage the whole product through it. Proposals appear in the chat as cards with Accept / Reject / Edit.
- PRD-15 Change log with undo for every applied change, whether made through the UI or the agent.
- PRD-16 Web app plus a mobile app for all household members (see [10-architecture.md](10-architecture.md) §7).
- PRD-17 Knowledge graph of ingredients, cuisines, methods, dishes and preferences, used for substitution, similarity and preference propagation. Built so it can later move to a dedicated graph database.
- PRD-18 Engaging, colourful, kitchen-themed interface (see [09-ux.md](09-ux.md)).

## 5. Out of scope (v1)

Stated explicitly so the builder does not add them: shopping lists and grocery ordering, pantry and inventory tracking, prep-session scheduling, budget and cost optimisation, food-waste tracking beyond ingredient consolidation, calorie logging of off-plan food, wearable or weight-trend integrations, and public recipe sharing between households. The owner can promote any of these in a later revision.

## 6. Core user stories

| ID | As | I want | So that |
|---|---|---|---|
| US-1 | admin | to add members with or without targets in one screen | setup is fast |
| US-2 | admin | to say "Sara trains Mon/Wed/Fri at 6pm" in chat | training slots appear on those days |
| US-3 | admin | to generate tomorrow's plan in one tap | the kitchen knows what to cook |
| US-4 | admin | to see each targeted member's per-meal macros against target, with pass/fail | I can trust the plan |
| US-5 | admin | to swap a dish and have portions re-solved automatically | macros stay on target |
| US-6 | kitchen | a cook sheet with raw kg/g quantities, methods and a plating table | I cook and plate correctly |
| US-7 | member | to rate tonight's dinner and comment "the fried fish was too oily" | the system learns |
| US-8 | admin | the system to propose "replace fried fish with grilled for Omar; he rated fried 2/5 three times" and accept it with one tap | preferences improve without manual work |
| US-9 | admin | to turn "appeal" up and "ingredient economy" down for weekends | the plan matches the occasion |
| US-10 | admin | to undo any change the agent applied | I stay in control |
| US-11 | admin | to start with "2000 kcal, 150P/200C/60F" and later set per-slot splits, sat-fat cap and soluble-fibre goal | detail is added only where I care |
| US-12 | member (child) | to thumbs-up or thumbs-down a packed lunch from my phone | my tastes count |

## 7. Success criteria (v1 acceptance)

- SC-1 For the reference household fixture ([11-build-plan.md](11-build-plan.md) fixture F1), a generated 7-day plan has **100%** of targeted member-meals within tolerance, or each miss is explicitly flagged with its reason and the smallest deviation found. Measured by an automated check.
- SC-2 In the same plan, distinct ingredients across the 7 days are at least 25% fewer than a baseline generated with ingredient-economy weight 0, with every other setting unchanged. Measured.
- SC-3 A 1-star review on a dish, repeated twice by the same member, measurably lowers that dish's appeal score for that member and produces a proposal. Measured.
- SC-4 Every agent-applied change appears in the change log and can be undone, restoring the prior state exactly. Measured.
- SC-5 The core flows (onboarding, plan, cook sheet, review, chat proposal accept) work at 390 px phone width and on desktop. Playwright.
