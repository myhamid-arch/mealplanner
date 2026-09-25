# Gates: leaf-1.4.6 Sign-in, People and access, account, platform

OWNS: docs/decisions/leaf-1.4.6-*.md, apps/web/app/(auth)/**, apps/web/app/(app)/access/**, apps/web/app/(app)/account/**, apps/web/app/(app)/changelog/**, apps/web/app/(platform)/**, apps/web/components/admin/**, apps/web/e2e/admin.spec.ts, scripts/verify/leaf-1.4.6.mjs

Scope: Sign-in, People and access, account, platform, as specified in docs/spec (see 11-build-plan.md §5 and 13-revision-r2.md), built to match docs/mockups where it has UI.

- [ ] G1: Playwright: password, magic-link stub and invite-code sign-in; invite then accept; block then 401; remove; last-admin protection; change-log undo
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.6 G1 PASSED
  EVIDENCE: pending

- [ ] G2: axe-core: no serious or critical violations on these screens
  CHECK: node scripts/verify/leaf-1.4.6.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.6 G2 PASSED
  EVIDENCE: pending

- [ ] G3: architect visual review against SignIn, CreateHousehold, InviteAccept, AccountPhone, PeopleAccess, InviteDialog, BlockDialog, HouseholdSettings, ChangeLog, PlatformConsole mockups
  EVIDENCE: pending
