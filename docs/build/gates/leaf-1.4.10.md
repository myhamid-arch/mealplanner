# Gates: leaf-1.4.10 Plain reasons, graph start-up, change-log subjects

OWNS: docs/decisions/leaf-1.4.10-*.md, packages/core/src/planner/select/score.ts, packages/core/src/planner/select/run.ts, packages/core/src/planner/select/pool.ts, packages/core/test/planner/select/reasons*.test.ts, apps/web/components/plan/plate-detail.tsx, apps/worker/src/main.ts, packages/graph/src/sync/**, packages/graph/test/startup*.test.ts, apps/web/test/api/kg-startup*.int.test.ts, apps/web/lib/server/changes.ts, apps/web/app/(app)/changelog/**, apps/web/test/api/change-log-detail*.int.test.ts, apps/web/test/followups/**, scripts/verify/leaf-1.4.10.mjs

Scope: W-12, W-13 and W-14 (R-68): plain-language planner reasons on the Plate, the graph's start-up sync order, and change-log entries that name their subject and show before and after, as specified in docs/spec (see 11-build-plan.md §5 and §8 W-12, W-13, W-14, R-68)

- [x] G1: plain reasons: ingredient display names and cuisine labels in score reasons; no slug, snake_case key or id in any reason over F1 seeds 1-10; no replaced ingredient named after a substitution; 1.2.3 G1-G6, 1.2.6 G1-G2 and 1.4.8 G1-G4 pass; negative control with today's labels
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.10 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=2169a7a26e4d205f68a590b747253cbb7f912a451c1b189e03316f2957edaf68; exit=0; EXPECT=matched; output-sha256=7426b07190d133099aa28614115b5c0fc058252da4c786342e372dab6ef44764; output-bytes=2523; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: graph start-up: both syncCatalogueGraph jobs at concurrency 2 on an empty graph with the F1 seed library: no missing-node failure and the graph equals kg:rebuild's; 1.3.4 G1-G3 pass; negative control: the pre-fix start-up fails (reproduced and recorded)
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.10 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=048685b7977647866f3a7ff8a45cd9823b861109913763ec12acc5ac9bf4f204; exit=0; EXPECT=matched; output-sha256=5446187dec3bc19ab550fd88fbbd71c7ae398bb289c5ccf1dc2155178a33901a; output-bytes=2302; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: change-log subjects: entries name their subject and scalar before -> after, resolved at read time with no migration; a vanished subject falls back to the stored title; 1.4.1 G1-G3 and 1.4.6 G1-G2 pass; negative controls: two blocks of different logins differ, title-only rendering fails
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.10 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b4bdd172ceaffd3bf30c1282046aea698e9248b136446295f5d8718a802edb30; exit=0; EXPECT=matched; output-sha256=002fc2e6d2b6d23ad951467830c2305f37d823823affa49f89983cabee7f4485; output-bytes=2250; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: Playwright 390/1280 plus axe-core (no serious or critical): Plate "Why this dinner" after a substitution and /changelog with a block, a target change and a settings change; 1.4.2 G1-G2 pass
  CHECK: node scripts/verify/leaf-1.4.10.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.10 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=307f7216284d6c831f985be2a6df9d77d300bef36b8f3dc557a2ead139594cae; exit=0; EXPECT=matched; output-sha256=95cbe78fa249a6ffd66d982ab71cbdf37959ad9098ac8914328a35532716390a; output-bytes=1349; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G5: architect visual review against PlatePhone and ChangeLog mockups
  EVIDENCE: architect CP3 review 2026-09-28 of the builder's G4 captures at 4def4be (artifact JLCTNt2SVYqk16hMakkPAw, 390 and 1280 px) against the rendered PlatePhone and ChangeLog mockups. Plate "Why this dinner": the fit is in words ("Close to Sara's and Omar's targets"), ingredients use display names in lower case separated by semicolons, and the replaced ingredient is not named. ChangeLog: subjects are named ("Blocked Ravi (kitchen)", "Sara's protein target 130 → 140 g", "Household settings: time zone …"), with before/after chips (labelled; accessibility deviation accepted at CP1) and dates written "Mon 28 Sep". Round 1 found raw fit scores, comma-ambiguous lists and ISO dates; all are fixed. The floating-button overlap at 390 px is 1.4.2's shell (W-15), outside this leaf. PASS.
