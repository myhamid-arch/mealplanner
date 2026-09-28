# Gates: leaf-1.4.11 Assistant button clearance at phone width

OWNS: docs/decisions/leaf-1.4.11-*.md, apps/web/app/(shell)/_shell/app-shell.tsx, apps/web/e2e/assistant-clearance*.spec.ts, scripts/verify/leaf-1.4.11.mjs

Scope: W-15 (R-77): at phone width the floating Assistant button no longer covers a page's last content once the page is scrolled to the end, as specified in docs/spec (see 09-ux UX-4, 11-build-plan.md §5 and §8 W-15, R-77)

- [ ] G1: clearance at 390 px and 360 px as admin on /account and a Plate page scrolled to the end: the Assistant button's box misses the last control and elementFromPoint at its centre hits it; roles without the assistant keep today's padding; negative control with the pre-fix padding
  CHECK: node scripts/verify/leaf-1.4.11.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.11 G1 PASSED
  EVIDENCE: pending

- [ ] G2: no regression: 1.4.2 G1-G2 and 1.4.9 G4 pass; axe-core no serious or critical on both pages at 390 px
  CHECK: node scripts/verify/leaf-1.4.11.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.11 G2 PASSED
  EVIDENCE: pending

- [ ] G3: architect visual review of both pages at 390 px scrolled to the end
  EVIDENCE: pending
