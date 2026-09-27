# Gates: leaf-1.4.7 Deferred scope W-5: onboarding parse, planning preview, first days

OWNS: docs/decisions/leaf-1.4.7-*.md, packages/ai/src/onboarding/**, packages/ai/test/onboarding/**, packages/core/src/onboarding/followups/**, packages/core/test/onboarding/followups/**, apps/web/app/api/v1/onboarding/**, apps/web/app/api/v1/plans/preview/**, apps/web/app/api/v1/setup-followups/**, apps/web/lib/server/onboarding-parse.ts, apps/web/lib/server/plan-preview.ts, apps/web/lib/server/setup-followups.ts, apps/web/test/api/onboarding-parse.int.test.ts, apps/web/test/api/plans-preview.int.test.ts, apps/web/test/api/setup-followups.int.test.ts, apps/worker/src/jobs/plans-preview.ts, apps/web/app/(app)/getting-started/**, apps/web/components/setup/**, apps/web/e2e/setup.spec.ts, packages/db/src/schema/setup.ts, packages/db/src/migrations/0006_*, packages/db/src/migrations/meta/0006_snapshot.json, scripts/verify/leaf-1.4.7.mjs

Scope: The W-5 deferred scope (R-55): model-backed onboarding free-text parse (R2-ONB-3), the PlanningBalance "Next week, if you save" preview (UX-4), and the first-days follow-up questions with the "Getting set up" checklist (R2-ONB-6), as specified in docs/spec (see 11-build-plan.md §5 and §8 W-5, R-55) and matching docs/mockups.

- [x] G1: onboarding parse: typed results from recorded model responses; schema-failing answers refused; 503 without credential with deterministic fallback in the page; admin only
  CHECK: node scripts/verify/leaf-1.4.7.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.7 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b4f510006542ca7b16d8501173b7d96e3d7992977e7df20be79deb6c7d31b9ec; exit=0; EXPECT=matched; output-sha256=6b24753e307e892319d396c482e6efdba4b6c15000ecbc2f42f246b2a8cab905; output-bytes=3756; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: planning preview: current vs proposed without writing plan rows; proposed equals the real replan with the same weights and seed
  CHECK: node scripts/verify/leaf-1.4.7.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.7 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f741468ce7c54b99dc156a1af44368c93e265cd84ec4a0cb8e80393604e6270b; exit=0; EXPECT=matched; output-sha256=d577dd06376a4edb721e389b4983ae2ae7d714611372b4319e1a965893114373; output-bytes=1701; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: first days: only unsettled items proposed (F1 expected list), one card per day, dismiss and answers persist, checklist progress; negative control
  CHECK: node scripts/verify/leaf-1.4.7.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.7 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=6bf98da7abc7a9028fb04dca05b05a33fe76da5eda19b83fe1739954619eebb3; exit=0; EXPECT=matched; output-sha256=cf30680599df0ae58900a69ba7a6db43056f2a7133cdfd6c0c5f2405a2f20cd1; output-bytes=1834; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G4: Playwright 390/1280 and axe-core (no serious or critical) on the preview panel, parse confirmation, follow-up card and checklist
  CHECK: node scripts/verify/leaf-1.4.7.mjs --gate G4
  EXPECT: VERIFY leaf-1.4.7 G4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=f07620ac575a2018e3996bd5d7084727c22eba702a08375cea5bb10fc3026624; exit=0; EXPECT=matched; output-sha256=70d48b7d8bd4fc4a1fc35bd9bf0663484bb9ceaa6f842685ed8d8e717e87e435; output-bytes=2764; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G5: architect visual review against PlanningBalance (preview panel) and FirstDaysPhone mockups
  MANUAL: architect compares screenshots at 390 and 1280 px with the mockups
  EVIDENCE: pending

- [ ] G6: live parse of the F1 answers through the real model matches the deterministic parse (owner handoff: needs ANTHROPIC_API_KEY)
  CHECK: node scripts/verify/leaf-1.4.7.mjs --live
  EXPECT: VERIFY leaf-1.4.7 LIVE PASSED
  EVIDENCE: pending

ABANDON: G6 owner credential handoff (BLD-8 R-56): no Anthropic credential exists in the build environment; the owner runs `ANTHROPIC_API_KEY=<key> node scripts/verify/leaf-1.4.7.mjs --live`, which parses the F1 answers with the live model and must print VERIFY leaf-1.4.7 LIVE PASSED (without a credential it refuses and exits 1)
