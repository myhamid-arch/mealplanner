# Gates: leaf-1.4.10 Plain reasons, graph start-up, change-log subjects

OWNS: docs/decisions/leaf-1.4.10-*.md, packages/core/src/planner/select/score.ts, packages/core/src/planner/select/run.ts, packages/core/src/planner/select/pool.ts, packages/core/test/planner/select/reasons*.test.ts, apps/web/components/plan/plate-detail.tsx, apps/worker/src/main.ts, packages/graph/src/sync/**, packages/graph/test/startup*.test.ts, apps/web/test/api/kg-startup*.int.test.ts, apps/web/lib/server/changes.ts, apps/web/app/(app)/changelog/**, apps/web/test/api/change-log-detail*.int.test.ts, apps/web/test/followups/**, scripts/verify/leaf-1.4.10.mjs

Scope: W-12, W-13 and W-14 (R-68): plain-language planner reasons on the Plate, the graph's start-up sync order, and change-log entries that name their subject and show before and after, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-12, W-13, W-14, R-68)

- [ ] G1: plain reasons: ingredient display names and cuisine labels in score reasons; no slug, snake_case key or id in any reason over F1 seeds 1-10; no replaced ingredient named after a substitution; 1.2.3 G1-G6, 1.2.6 G1-G2 and 1.4.8 G1-G4 pass; negative control with today's labels
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.10 G1 PASSED
  EVIDENCE: pending

- [x] G2: graph start-up: both syncCatalogueGraph jobs at concurrency 2 on an empty graph with the F1 seed library: no missing-node failure and the graph equals kg:rebuild's; 1.3.4 G1-G3 pass; negative control: the pre-fix start-up fails (reproduced and recorded)
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.10 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=048685b7977647866f3a7ff8a45cd9823b861109913763ec12acc5ac9bf4f204; exit=0; EXPECT=matched; output-sha256=ae9257670e6094bb500f0cdd817a6c114c2d04a4edbf0cbcb5eb4cffbf5a3e30; output-bytes=2255; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G3: change-log subjects: entries name their subject and scalar before -> after, resolved at read time with no migration; a vanished subject falls back to the stored title; 1.4.1 G1-G3 and 1.4.6 G1-G2 pass; negative controls: two blocks of different logins differ, title-only rendering fails
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.10 G3 PASSED
  EVIDENCE: pending

- [ ] G4: Playwright 390/1280 plus axe-core (no serious or critical): Plate "Why this dinner" after a substitution and /changelog with a block, a target change and a settings change; 1.4.2 G1-G2 pass
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.10 G4 PASSED
  EVIDENCE: pending

- [ ] G5: architect visual review against PlatePhone and ChangeLog mockups
  EVIDENCE: pending
