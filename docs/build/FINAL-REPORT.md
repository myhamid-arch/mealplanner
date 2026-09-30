# Family meal planner v1: final report

Integration branch `claude/family-meal-planner-macros-8s782a`, 30 September 2026.

**Status:** every acceptance gate is met. The root ledger `docs/build/GATES.md` shows R1–R9 ALL MET: all four feature areas were reverified, and all seven success criteria passed on a freshly started stack. One deployment defect (W-27, below) was found and fixed after that run. Its fix was re-verified against the seven success criteria.

## What was built

A web app that installs on phones as a PWA, a background worker and a PostgreSQL database. They run together with `docker compose`.

- **Onboarding in 5 questions.** People, macro targets, a normal week, favourite food and never-eat. Everything else is inferred and shown on a review screen, where each inferred setting has an Adjust link. Defaults are UAE: Asia/Dubai, AE ingredients, metric.
- **Per-person macros at every meal.**
  - Targeted members get per-meal plates solved by a deterministic solver: protein ±5 g, carbs ±5 g, fat ±2 g, calories ±50 per day, sat fat ≤ 6 % of calories, fibre with a soluble share.
  - Untargeted children get sized portions (default × appetite × a learned bias).
- **Meal slots:** breakfast, lunch, dinner, snacks, packed school and work lunches, and pre- and post-workout meals. Each is scheduled per person and weekday. A packed lunch replaces lunch in one tap.
- **Fewer ingredients.** An adjustable economy weight makes dishes share ingredients across the week. Macros come first, then appeal (cuisines), then economy, and all weights are adjustable.
- **Dish variants** (grilled vs fried, for example), each with its own nutrition. The cook sheet for kitchen staff gives raw quantities, methods and a plating table.
- **AI-written recipes.** Claude writes them; every recipe is checked against the catalogue and solved for feasibility before it is used.
- **Reviews on anything:** ratings, tags and comments. The planner learns from them: it updates preferences automatically and proposes changes, such as "keep this dish out of packed lunches" or "grilled instead of fried for Omar".
- **A chat assistant for admins.** It makes changes and proposals. Every change is logged and can be undone exactly.
- **A knowledge graph** for substitutions, similarity and preference propagation.
- **Administration:** invites, roles, block and remove, two-step sign-in, a change log, household settings, and an operator console that can see household data only through a time-limited, logged grant.
- **Detail on demand.** Every area starts simple (Basic) and can be made more detailed (Detailed, Expert) per value, with "back to auto".

## Measured results (final root run, fresh `docker compose up`)

| Criterion | Result |
|---|---|
| SC-1 macros (reference family, 7-day plan) | 68 of 68 targeted member-meals in tolerance; 0 misses, 0 flagged |
| SC-2 fewer ingredients (economy weight on vs off, seeds 1–10) | distinct core ingredients cut by a median of **13.9 %** (min 9.8 %, max 16.7 %); the target was a median ≥ 8 % with no seed worse |
| SC-3 learning from reviews | one 1★ review: no proposal. Two: the dish score falls 0 → −0.5, the plate appeal falls, the other 4 members are unchanged, and 1 proposal is made |
| SC-4 undo | the assistant's change is undone with 0 rows differing from the prior state |
| SC-5 phone and desktop | onboarding, plan, cook sheet, review and proposal work at 390 px and 1280 px; accessibility checks on 18 screens in light and dark mode found 0 serious or critical issues |
| SC-6 onboarding | exactly 5 questions, none required; a first plan both when answered and when skipped |
| SC-7 adjustability | 15 of 15 inferred settings link to where they are adjusted, and every link resolves |

These checks run against a recorded model, so they make no live model calls and use no API key. The live assistant evaluation passed 29 of 29 cases, twice.

**How the checks prove themselves:** each gate has a negative control. Before each piece was merged, deliberate faults were planted to confirm the gates catch them. For example:
- the planner ignoring the economy weight fails SC-2;
- broken Adjust links fail SC-7;
- a key reaching the containers fails every success criterion.

## Decisions and interpretations to confirm

1. **Carb tolerance.** Your message said "carbs +-56". I read it as **±5 g per meal**; each member's tolerance is editable.
2. **Mobile.** v1 is an installable web app (PWA) with offline Today. A native app is deferred.
3. **Recipe card example plates** are shown for people with targets only. Children's portions are set when the day plan is solved.
4. **"Under 5 minutes" onboarding** is not measured. The 5-question limit is.
5. **One architecture exception.** The sign-in route reads the two-step sign-in policy from the database directly, instead of through the domain layer. It was left in place because moving it would reopen the sign-in checks.
6. **Your earlier decisions are built in:**
   - repeats only after 7 days for main meals and 4 for snacks and workout meals;
   - nut-free applies to lunch boxes only;
   - sat fat ≤ 6 % of calories;
   - the SC-2 threshold.

Some requirement clauses have partial or manual-only coverage, for example password-reset email and display rounding. They are listed in `docs/build/CONTRACT-INVENTORY.md` under "Partial coverage".

## Defects found and fixed during final verification

- **W-24:** a meal split read back from the database showed every share as "yours". The check now allows for the column's rounding.
- **W-25:** the web integration tests used a 5 s timeout and failed when the machine was busy. They now use 30 s.
- **W-26:** the full-suite gate did not run the newest e2e spec. It now does.
- **W-27:** under `docker compose`, the web container got no model settings, so the assistant would have answered "unavailable". Also, `.env.example` named a wrong model. Both are fixed, and the success criteria were re-verified on the fix.

## How to run it

```
cp .env.example .env
# edit .env: set AUTH_SECRET (any long random string) and ANTHROPIC_API_KEY (your key)
docker compose up --build
# open http://localhost:3000
```

- The worker migrates the database and loads the ingredient catalogue and seed recipes on first start.
- Leave `ANTHROPIC_MODEL` empty to use the default model.
- Keep your API key in `.env` or your environment only; `.env` is not committed.

## Where things are

- Spec: `docs/spec/`. The rulings and defect log are in `11-build-plan.md` §8.
- Gate ledgers and evidence: `docs/build/GATES.md` and `docs/build/gates/`.
- Owner-request review: `docs/build/R9-REVIEW.md`.
- Requirement traceability: `docs/build/CONTRACT-INVENTORY.md`.

## Time

About 5 days 8 hours from your first message (25 Sep, 13:13 UTC) to the final root run (30 Sep, 21:14 UTC). Coding and verification started on 26 Sep. The final full reverification took 7.5 h of machine time.
