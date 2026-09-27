# Gates: leaf-1.4.6 Sign-in, People and access, account, platform

OWNS: docs/decisions/leaf-1.4.6-*.md, apps/web/app/(auth)/**, apps/web/app/(app)/access/**, apps/web/app/(app)/account/**, apps/web/app/(app)/changelog/**, apps/web/app/(app)/settings/household/**, apps/web/app/(platform)/**, apps/web/components/admin/**, apps/web/e2e/admin.spec.ts, scripts/verify/leaf-1.4.6.mjs

Scope: Sign-in, People and access, account, platform, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright: password, magic-link stub and invite-code sign-in; invite then accept; block then 401; remove; last-admin protection; change-log undo
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.6 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fcd181129407c0a4f60f0da67db9d6a58679edea8d519c52fbd6060bcc54ef78; exit=0; EXPECT=matched; output-sha256=6d67caec2bda6c994f29a5f03c05c1d1ceb26a48fa53bb063240e63ffc992e2b; output-bytes=3622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.6 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=adddd3a42842cfc5e60063d1836fb245d15b35b9461b9fa29d89c08328786685; exit=0; EXPECT=matched; output-sha256=38f2f4493d3c95ea732e236d92c3c24eeb03466f5cdcde8924cb5afe855533f8; output-bytes=2979; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [ ] G3: architect visual review against SignIn, CreateHousehold, InviteAccept, AccountPhone, PeopleAccess, InviteDialog, BlockDialog, HouseholdSettings, ChangeLog, PlatformConsole mockups
  EVIDENCE: pending
