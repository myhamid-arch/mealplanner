# Gates: leaf-1.4.6 Sign-in, People and access, account, platform

OWNS: docs/decisions/leaf-1.4.6-*.md, apps/web/app/(auth)/**, apps/web/app/(app)/access/**, apps/web/app/(app)/account/**, apps/web/app/(app)/changelog/**, apps/web/app/(app)/settings/household/**, apps/web/app/(platform)/**, apps/web/components/admin/**, apps/web/e2e/admin.spec.ts, scripts/verify/leaf-1.4.6.mjs

Scope: Sign-in, People and access, account, platform, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [x] G1: Playwright: password, magic-link stub and invite-code sign-in; invite then accept; block then 401; remove; last-admin protection; change-log undo
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.6 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=fcd181129407c0a4f60f0da67db9d6a58679edea8d519c52fbd6060bcc54ef78; exit=0; EXPECT=matched; output-sha256=2197da1af4ff699b0824b6b1a90b709abecb184c4fd46251c6ebd70518db3ce4; output-bytes=3622; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.6 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=adddd3a42842cfc5e60063d1836fb245d15b35b9461b9fa29d89c08328786685; exit=0; EXPECT=matched; output-sha256=186eedfb82fa8c7352a25f47de0ee02f1fa53352c597620d1c277232f3cd3dbe; output-bytes=2979; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: architect visual review against SignIn, CreateHousehold, InviteAccept, AccountPhone, PeopleAccess, InviteDialog, BlockDialog, HouseholdSettings, ChangeLog, PlatformConsole mockups
  EVIDENCE: architect review 2026-09-27. Implementation: builder screenshots at 3f6b6c7 (artifact PofKHvYS6FUAbVmnKsAtF4, 390 and 1280 px). Mockups: rendered from docs/mockups/*.dc.html. PeopleAccess and HouseholdSettings were reviewed at CP3 (PR #15). The remaining 8 were reviewed 2026-09-27 because the CP3 comment covered only those 2. All 10 match layout, content and actions, except for recorded deviations: no no-password button (R-48); "You're invited to" without the inviter's name (SPEC-Q-16); invite code, link and QR shown after creation (SPEC-Q-17); change-log titles are the change sets' summaries, with no before/after chips (SPEC-Q-18, and see W-14); no Catalogue tab and no "Active logins (7 days)" stat (SPEC-Q-12); 6 % sat-fat default; metric-only units. One unrecorded minor difference was accepted: CreateHousehold replaces the "Change" link with "Change any of these later in Settings". PASS.
