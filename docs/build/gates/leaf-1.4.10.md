# Gates: leaf-1.4.10 Plain reasons, graph start-up, change-log subjects

OWNS: docs/decisions/leaf-1.4.10-*.md, packages/core/src/planner/select/score.ts, packages/core/src/planner/select/run.ts, packages/core/src/planner/select/pool.ts, packages/core/test/planner/select/reasons*.test.ts, apps/web/components/plan/plate-detail.tsx, apps/worker/src/main.ts, packages/graph/src/sync/**, packages/graph/test/startup*.test.ts, apps/web/test/api/kg-startup*.int.test.ts, apps/web/lib/server/changes.ts, apps/web/app/(app)/changelog/**, apps/web/test/api/change-log-detail*.int.test.ts, apps/web/test/followups/**, scripts/verify/leaf-1.4.10.mjs

Scope: W-12, W-13 and W-14 (R-68): plain-language planner reasons on the Plate, the graph's start-up sync order, and change-log entries that name their subject and show before and after, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-12, W-13, W-14, R-68)

- [x] G1: plain reasons: ingredient display names and cuisine labels in score reasons; no slug, snake_case key or id in any reason over F1 seeds 1-10; no replaced ingredient named after a substitution; 1.2.3 G1-G6, 1.2.6 G1-G2 and 1.4.8 G1-G4 pass; negative control with today's labels
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.10 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2169a7a26e4d205f68a590b747253cbb7f912a451c1b189e03316f2957edaf68; exit=0; EXPECT=matched; output-sha256=1835b1eceb123cd541f2a2b05fbd7f96b2605cb08932a02f2e11c3830a35d1c9; output-bytes=2529; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: graph start-up: both syncCatalogueGraph jobs at concurrency 2 on an empty graph with the F1 seed library: no missing-node failure and the graph equals kg:rebuild's; 1.3.4 G1-G3 pass; negative control: the pre-fix start-up fails (reproduced and recorded)
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.10 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=048685b7977647866f3a7ff8a45cd9823b861109913763ec12acc5ac9bf4f204; exit=0; EXPECT=matched; output-sha256=fd0a5a5e8adf78b82e3859d6cad9fde6b7a93e53c4a55716cb610230e914cf3c; output-bytes=2301; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: change-log subjects: entries name their subject and scalar before -> after, resolved at read time with no migration; a vanished subject falls back to the stored title; 1.4.1 G1-G3 and 1.4.6 G1-G2 pass; negative controls: two blocks of different logins differ, title-only rendering fails
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.10 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b4bdd172ceaffd3bf30c1282046aea698e9248b136446295f5d8718a802edb30; exit=0; EXPECT=matched; output-sha256=d4a48a9283bc20acf838077c2b31f18fa9926f2165ddee5dd4a274072b8d4c59; output-bytes=2159; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: Playwright 390/1280 plus axe-core (no serious or critical): Plate "Why this dinner" after a substitution and /changelog with a block, a target change and a settings change; 1.4.2 G1-G2 pass
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.10 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=307f7216284d6c831f985be2a6df9d77d300bef36b8f3dc557a2ead139594cae; exit=0; EXPECT=matched; output-sha256=a30bac17f15894a036eeea30e598959458a44ac1dfc79e63fccfe546574831c0; output-bytes=1348; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G5: architect visual review against PlatePhone and ChangeLog mockups
  EVIDENCE: pending
