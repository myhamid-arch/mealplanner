# Gates: leaf-1.4.5 Reviews, Insights, Chat UI

OWNS: docs/decisions/leaf-1.4.5-*.md, apps/web/app/(app)/reviews/**, apps/web/app/(app)/insights/**, apps/web/app/(app)/chat/**, apps/web/components/chat/**, apps/web/components/reviews/**, apps/web/e2e/chat.spec.ts, scripts/verify/leaf-1.4.5.mjs

Scope: Reviews, Insights, Chat UI, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: Playwright: quick rating and detailed review, proposal appears, accept, undo (stubbed model)
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.5 G1 PASSED
  EVIDENCE: pending

- [ ] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.5 G2 PASSED
  EVIDENCE: pending

- [ ] G3: chat renders every AGT-7 card type from recorded tool results
  CHECK: node scripts/verify/leaf-1.4.5.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.5 G3 PASSED
  EVIDENCE: pending

- [ ] G4: architect visual review against QuickRatePhone, ReviewComposePhone, ReviewsFeed, Insights, Chat* mockups
  EVIDENCE: pending
