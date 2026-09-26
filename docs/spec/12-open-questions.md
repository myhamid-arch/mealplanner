# 12 — Open questions for the owner

Each question has the default the spec currently assumes. The build can start with the defaults. Answers change only the IDs listed.

| ID | Question | Current default | Affects |
|---|---|---|---|
| OQ-1 | Carbohydrate tolerance was written as "+-56". Is that ±5 g per meal? | ±5 g per meal | DM `tolerance`, PLN-5 |
| OQ-2 | "Calories as special": should calories have their own per-meal tolerance, and if so how wide? Or are they only derived from P/C/F? | **Answered 2026-09-26: ±50 kcal for the whole day, not per meal** (R-28) | DM `tolerance`, PLN-4, PLN-5 |
| OQ-3 | Mobile: is an installable web app (PWA) acceptable for v1, with the native iOS/Android app (Expo) straight after? Or must native ship in v1? | PWA in v1, native in phase B | ARC-8, build plan |
| OQ-4 | Saturated-fat limit and soluble-fibre priority: are there default numbers for members who don't enter them? | **Answered 2026-09-26: sat fat ≤ 6 % of kcal; total fibre 14 g per 1,000 kcal, of which at least 25 % soluble** (R-28) | PLN-4, PLN-5 |
| OQ-5 | Should AI-generated recipes go straight into plans, or wait for your approval? | Straight in, marked "New" (`ai_generation = auto`) | PLN-12 |
| OQ-6 | Hosting: any requirement on provider or on data staying in the UAE? | None assumed. Docker Compose on a single VM. | ARC-11 |
| OQ-7 | Are your carbohydrate targets **total** carbs (fibre included, as on a US-style label) or **net** carbs (fibre excluded)? | **Answered 2026-09-26: total** — the planner matches the carb target against `carbs_g + fibre_g` | PLN-5, target resolver (1.2.2), UI macro display (R-20) |

Needed from the owner before the Claude-dependent gates can pass (1.3.1-G4, 1.3.5-G4): an Anthropic API credential available to the build environment as `ANTHROPIC_API_KEY`. Without it, those gates end as explicit handoffs, and everything else is built and verified with recorded or stubbed model responses.
