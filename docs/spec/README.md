# Family Meal Planner — Specification

Status: **r2 — UI approved in mockups; build may start.** Open questions in [12-open-questions.md](12-open-questions.md) use their stated defaults until the owner answers. **[13-revision-r2.md](13-revision-r2.md) overrides earlier files where they conflict.** Visual reference: [`docs/mockups/`](../mockups/). Build ledgers: [`docs/build/`](../build/).

Roles:
- **Owner** — the person commissioning the product. Approves spec revisions, answers open questions.
- **Architect** — owns this spec, splits work into builder leaves, reviews every returned leaf against the spec, re-verifies gates, and integrates.
- **Builder** — implements one leaf at a time against this spec and its gate ledger. Never changes the spec; raises a spec question instead.

## Documents

| # | File | Contents |
|---|---|---|
| 01 | [01-product.md](01-product.md) | Goals, priority order, users and roles, scope, core user stories |
| 02 | [02-domain-model.md](02-domain-model.md) | Entities, relationships, database schema |
| 03 | [03-nutrition-engine.md](03-nutrition-engine.md) | Ingredient data, preparation methods, cooked-weight nutrition math |
| 04 | [04-planner.md](04-planner.md) | Targets, meal slots, portion solver, weighted dish selection, ingredient consolidation |
| 05 | [05-recipe-generation.md](05-recipe-generation.md) | AI recipe authoring, structured output, validation |
| 06 | [06-feedback-and-learning.md](06-feedback-and-learning.md) | Review system, preference learning, insights, proposals |
| 07 | [07-agent.md](07-agent.md) | Conversational admin agent, tools, proposal cards, apply/undo |
| 08 | [08-knowledge-graph.md](08-knowledge-graph.md) | Graph model, uses, migration path |
| 09 | [09-ux.md](09-ux.md) | Screens, progressive granularity, visual design system |
| 10 | [10-architecture.md](10-architecture.md) | Stack, repo layout, API, auth, jobs, mobile, deployment |
| 11 | [11-build-plan.md](11-build-plan.md) | Depth tree, leaves, ownership, gates, architect/builder protocol |
| 12 | [12-open-questions.md](12-open-questions.md) | Decisions the owner must confirm |
| 13 | [13-revision-r2.md](13-revision-r2.md) | Decisions from the approved mockups (onboarding, detail levels, shared/individual meals, administration) |

## Requirement IDs

Every normative requirement has an ID (`PRD-`, `DM-`, `NUT-`, `PLN-`, `REC-`, `FBK-`, `AGT-`, `KG-`, `UX-`, `ARC-`). Gates in [11-build-plan.md](11-build-plan.md) cite these IDs. "MUST" is mandatory; "SHOULD" is expected unless a leaf records a reason; "MAY" is optional.

## Glossary

| Term | Meaning |
|---|---|
| Household | One tenant: a family using the app. All data except the global catalog is household-scoped. |
| Member | A person in a household who eats. May or may not have a login. May or may not have macro targets. |
| Targeted member | A member with macro targets. The solver must hit their targets per meal. |
| Untargeted member | A member without targets (e.g. children). Gets appeal-driven standard portions. |
| Admin | A household user with management rights; talks to the agent and accepts proposals. "Main user" in the brief. |
| Slot | A meal occasion in a day: breakfast, lunch, dinner, snack, packed school lunch, packed work lunch, pre-workout, post-workout, or custom. |
| Dish | A recipe made of components. |
| Component | A part of a dish that the kitchen cooks and portions separately (e.g. fish, rice, salad, sauce). |
| Preparation variant | One way of preparing a component (grilled vs fried fish). Same ingredients, different method → different macros and appeal. |
| Plate | What one member is served at one slot: a dish, a chosen variant per component, and cooked grams per component. |
| Cook sheet | The kitchen staff's view: what to cook, raw quantities, methods, steps, and the plating table (grams per member). |
| Weights | Owner-adjustable importance of macro precision, appeal, and ingredient economy. |
| Proposal | A change the system suggests; the admin accepts or rejects it in the chat. |
