# Gates: leaf-1.4.11 Assistant button clearance at phone width

OWNS: docs/decisions/leaf-1.4.11-*.md, apps/web/app/(shell)/_shell/app-shell.tsx, apps/web/e2e/assistant-clearance*.spec.ts, scripts/verify/leaf-1.4.11.mjs

Scope: W-15 (R-77): at phone width the floating Assistant button no longer covers a page's last content once the page is scrolled to the end, as specified in docs/spec (see 09-ux UX-4, 11-build-plan.md §5 and §8 W-15, R-77)

- [x] G1: clearance at 390 px and 360 px as admin on /account and a Plate page scrolled to the end: the Assistant button's box misses the last control and elementFromPoint at its centre hits it; roles without the assistant keep today's padding; negative control with the pre-fix padding
  CHECK: node scripts/verify/leaf-1.4.11.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.11 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1c5316b5bc5df07d3b6fb1bb3bd2183d5cf30bb6385a4add97abdedf76f4cd2; exit=0; EXPECT=matched; output-sha256=b90436ac207fe46deda30d3948dc5b98009aa7c9754760292b069812d533aa7a; output-bytes=3575; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: no regression: 1.4.2 G1-G2 and 1.4.9 G4 pass; axe-core no serious or critical on both pages at 390 px
  CHECK: node scripts/verify/leaf-1.4.11.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.11 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=670039259300843b5603b7ab109dbcf70517b98ab54a02b2504e1ea5b98bcfd4; exit=0; EXPECT=matched; output-sha256=38e005cce8e386c4f0abd454d1ca79b5d1857ee0e0beb3d75727e576ba66a554; output-bytes=1169; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: architect visual review of both pages at 390 px scrolled to the end
  EVIDENCE: architect CP3 review 2026-09-28 of the builder's G1 captures at 8e16ccc (artifact Xjw1yhjqEduXx7mSTNygcn, 390 x 844, admin, scrolled to the end). Plate: before, the Assistant button covers "See recipe" (the W-15 defect); after, "Rate this meal" and "See recipe" sit fully above the button with clear space. /account: after, "Delete my account" and "Sign out" clear the button by a wide margin (1.4.6's pb-16 plus this leaf's 74 px, R-78). Tab bar, cards and button placement are unchanged; nothing else moved.
