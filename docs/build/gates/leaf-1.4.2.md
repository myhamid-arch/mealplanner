# Gates: leaf-1.4.2 Design system, app shell, PWA

OWNS: docs/decisions/leaf-1.4.2-*.md, packages/ui-tokens/**, apps/web/app/layout.tsx, apps/web/app/globals.css, apps/web/app/(shell)/**, apps/web/app/(app)/layout.tsx, apps/web/components/ui/**, apps/web/public/**, apps/web/next.config.*, apps/web/playwright.config.ts, apps/web/postcss.config.mjs, apps/web/e2e/shell.spec.ts, scripts/verify/leaf-1.4.2.mjs

Scope: Design system, app shell, PWA, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: tokens in light and dark; automated AA contrast check passes for every text/background pair used (UX-5)
  CHECK: node scripts/verify/leaf-1.4.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.2 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=8ace66e9f0664be9764da04038e44bde20c0f32396ffd4edccbde36b89e02373; exit=0; EXPECT=matched; output-sha256=5230a3baf832d2149023b5107f94af3d3fd9eff4615f51978fb75e30adf60732; output-bytes=3288; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: shell renders at 390 px and 1280 px without horizontal scroll; PWA installability check passes
  CHECK: node scripts/verify/leaf-1.4.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.2 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=4e32809e3b28a45bd479347be602e7c8fa6ae2adbaa4b61444de42309f6800aa; exit=0; EXPECT=matched; output-sha256=121349335da1774de3c752defcb9989fcefb4e98be6a1b794584f33bb37d6dd0; output-bytes=3333; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G3: architect visual review against UX-5 and docs/mockups/Rail.dc.html and TabBar.dc.html
  EVIDENCE: pending
