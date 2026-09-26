# leaf-1.2.2 ADR-2: fibre goals as penalised shortfall

Status: accepted (implements the architect's R-28 amendment on PR #6)

## Context
The owner answered OQ-4: total fibre ≥ 14 g per 1,000 kcal of the day's target, of which ≥ 25 % soluble, when a member sets no goals. R-28 makes both **soft** goals: soluble fibre is unknown for 208 of the 363 catalogue ingredients, so a hard minimum would make plans infeasible on missing data rather than on food. It replaces the r2 objective term `− λ_sf · solubleFibre` (a reward with no goal) with a penalised shortfall below each goal, and asks for the shortfall to be reported.

## Decision
- The resolver puts `fibreGoal` and `solubleFibreGoal` on every targeted `SlotTarget`, split by slot share like the other daily values: the member's `fibre_min_g`, else 14 g × kcal/1,000; the member's `soluble_fibre_min_g`, else 25 % of that fibre goal.
- The MILP gets one continuous shortfall column per goal, `s ≥ 0`, with the row `Σ fibre·g + s ≥ goal`. Unknown soluble fibre counts as 0 (NUT-8), so a variant with unknown soluble fibre never helps meet the soluble goal.
- Objective weights, in `planner/solver/config.ts`:
  - `LAMBDA_FIBRE_SHORTFALL = 0.05` per gram of total-fibre shortfall;
  - `LAMBDA_SOLUBLE_FIBRE_SHORTFALL = 0.1` per gram of soluble-fibre shortfall.

  For scale, the centring term costs 0.2 per gram of protein deviation (1 / ±5 g). A whole slot's soluble goal (about 2 g at dinner) is worth about 0.2, the same as 1 g of protein centring. So the goals choose between plates that are all inside tolerance; they never push a plate out of it (tolerances stay hard in strict mode). Soluble fibre weighs twice total fibre because it is the owner's stated priority and the scarcer of the two.
- `PlateSolution.shortfall = { fibre, solubleFibre }` in grams, recomputed in TypeScript from the plate's grid grams. It is 0 when a goal is met, and 0 for untargeted plates. `explain` names a non-zero shortfall.

## Consequences
- The LP-relaxation pruning (ADR-1) stays exact: the shortfall columns are continuous and appear in both the relaxation and the MILP.
- The weights are constants, not user settings, like the other λ values (04 §4).

## R-29: λ_ratio = 2 (SPEC-Q-17)
The architect ruled SPEC-Q-17 (BLD-8 R-29): `LAMBDA_RATIO = 2`, up from 04's 0.5. The fibre weights above are scaled against the centring term, which is unchanged, so they stay as they are. Median ratio deviation on the G4 plates (350 in-tolerance F1 plates) before the change, and in a diagnostic run at 2:

| λ_ratio | median ratio deviation | p90 |
|---|---|---|
| 0.5 | 0.276 | 0.440 |
| 2 | 0.200 | 0.373 |

The verify-script measurement after the change is in the PR's CP2 record.
