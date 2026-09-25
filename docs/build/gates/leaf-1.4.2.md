# Gates: leaf-1.4.2 Design system, app shell, PWA

OWNS: docs/decisions/leaf-1.4.2-*.md, packages/ui-tokens/**, apps/web/app/layout.tsx, apps/web/app/globals.css, apps/web/app/(shell)/**, apps/web/components/ui/**, apps/web/public/**, apps/web/next.config.*, apps/web/e2e/shell.spec.ts, scripts/verify/leaf-1.4.2.mjs

Scope: Design system, app shell, PWA, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: tokens in light and dark; automated AA contrast check passes for every text/background pair used (UX-5)
  CHECK: node scripts/verify/leaf-1.4.2.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.2 G1 PASSED
  EVIDENCE: pending

- [ ] G2: shell renders at 390 px and 1280 px without horizontal scroll; PWA installability check passes
  CHECK: node scripts/verify/leaf-1.4.2.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.2 G2 PASSED
  EVIDENCE: pending

- [ ] G3: architect visual review against UX-5 and docs/mockups/Rail.dc.html and TabBar.dc.html
  EVIDENCE: pending
