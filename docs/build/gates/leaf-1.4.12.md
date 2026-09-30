# Gates: leaf-1.4.12 Contract gaps in the planning screens

OWNS: docs/decisions/leaf-1.4.12-*.md, apps/web/e2e/contract-gaps*.spec.ts, scripts/verify/leaf-1.4.12.mjs, apps/web/e2e/contract-gaps/**, apps/web/components/config/tastes-section.tsx

Scope: R-82: close the contract gaps the root review (R9) found in node-1.4's scope — PLN-3's one-tap "replaces lunch" and R2-DL-6's "tell the assistant" in each detail-level section, both implemented and untested, as specified in docs/spec (04 PLN-3, 13 R2-DL-6, 11-build-plan.md §8 R-82)

- [x] G1: PLN-3 at 390 and 1280 px: in the attendance editor, one tap marks a member's packed lunch as replacing lunch; the stored schedule has that member off lunch on those days, and the next generated plan has no lunch plate and a packed plate for them there; without the tap the lunch plate stays (negative control)
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G1
  EXPECT: VERIFY leaf-1.4.12 G1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=e64ee31ab06ec36fb0a7776b1feaa616f1ef39d8a091e2a3e0e484a9aff38861; exit=0; EXPECT=matched; output-sha256=8bd0fe2c52b0a5e08c2a05b4663b20fc1fb7b58a4002d85779fb9df006fb542a; output-bytes=1285; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G2: R2-DL-6 at 390 and 1280 px: every detail-level section on a member's page offers "Tell the assistant"; it opens chat with a request naming that member and section, and a recorded agent turn applies the change at that section's level; a section without the control fails the same check (negative control)
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G2
  EXPECT: VERIFY leaf-1.4.12 G2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=d07676c97efcae10234c53cea8c206479ee22d1b9c5cee5d66ecaf801a708202; exit=0; EXPECT=matched; output-sha256=cf637d5dbe44cbad79780d8e1f38a422e701c59bd8d1a28ea83d7b8d7471d318; output-bytes=2172; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] G3: no regression: leaf-1.4.3 G1 and G3 pass
  CHECK: node scripts/verify/leaf-1.4.12.mjs --gate G3
  EXPECT: VERIFY leaf-1.4.12 G3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=525ab883bed3f0ed330c81322b43ef2a42539a6d06742a3f18d26697ee7ccebb; exit=0; EXPECT=matched; output-sha256=11b4270015b1fffd3b2b73a6a4333305b89f5076be249398eae6c9ebb4e7a633; output-bytes=237; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries
