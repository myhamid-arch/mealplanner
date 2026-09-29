# Gates: leaf-1.4.12 Contract gaps in the planning screens

OWNS: docs/decisions/leaf-1.4.12-*.md, apps/web/e2e/contract-gaps*.spec.ts, scripts/verify/leaf-1.4.12.mjs, apps/web/e2e/contract-gaps/**, apps/web/components/config/tastes-section.tsx

Scope: R-82: close the contract gaps the root review (R9) found in node-1.4's scope — PLN-3's one-tap "replaces lunch" and R2-DL-6's "tell the assistant" in each detail-level section, both implemented and untested, as specified in docs/spec (04 PLN-3, 13 R2-DL-6, 11-build-plan.md §8 R-82)

- [ ] G1: PLN-3 at 390 and 1280 px: in the attendance editor, one tap marks a member's packed lunch as replacing lunch; the stored schedule has that member off lunch on those days, and the next generated plan has no lunch plate and a packed plate for them there; without the tap the lunch plate stays (negative control)
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.12 G1 PASSED
  EVIDENCE: pending

- [ ] G2: R2-DL-6 at 390 and 1280 px: every detail-level section on a member's page offers "Tell the assistant"; it opens chat with a request naming that member and section, and a recorded agent turn applies the change at that section's level; a section without the control fails the same check (negative control)
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.12 G2 PASSED
  EVIDENCE: pending

- [ ] G3: no regression: leaf-1.4.3 G1 and G3 pass
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.12 G3 PASSED
  EVIDENCE: pending
