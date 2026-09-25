# Gates: Meal planner v1 (root)

Scope: the whole v1 as specified in docs/spec r2, integrated and accepted

- [ ] R1: all four branches reverified
  CHECK: node .claude/skills/unlazy/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 docs/build/gates/node-1.1.md docs/build/gates/node-1.2.md docs/build/gates/node-1.3.md docs/build/gates/node-1.4.md
  EXPECT: ALL MET
  EVIDENCE: pending

- [ ] R2: SC-1 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-1
  EXPECT: VERIFY root SC-1 PASSED
  EVIDENCE: pending

- [ ] R3: SC-2 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-2
  EXPECT: VERIFY root SC-2 PASSED
  EVIDENCE: pending

- [ ] R4: SC-3 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-3
  EXPECT: VERIFY root SC-3 PASSED
  EVIDENCE: pending

- [ ] R5: SC-4 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-4
  EXPECT: VERIFY root SC-4 PASSED
  EVIDENCE: pending

- [ ] R6: SC-5 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-5
  EXPECT: VERIFY root SC-5 PASSED
  EVIDENCE: pending

- [ ] R7: SC-6 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-6
  EXPECT: VERIFY root SC-6 PASSED
  EVIDENCE: pending

- [ ] R8: SC-7 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-7
  EXPECT: VERIFY root SC-7 PASSED
  EVIDENCE: pending

- [ ] R9: owner requests and spec r2 reread; every contract row reconciled by the architect
  EVIDENCE: pending
