# Gates: Meal planner v1 (root)

Scope: the whole v1 as specified in docs/spec r2, integrated and accepted

- [x] R1: all four branches reverified
  CHECK: node scripts/verify/root.mjs --gate R1
  EXPECT: VERIFY root R1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=52de3f4b150084f8cc652b6ea4c51405fb1c530d0af20d1c9029590a86642aa2; exit=0; EXPECT=matched; output-sha256=21b3a44cc4ea63709903d26405ed00cd6d505cca6845e69ad20387d73374f6a7; output-bytes=13050; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R2: SC-1 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-1
  EXPECT: VERIFY root SC-1 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=b50c97135213f5184d36619c38de51a25e9401c16e89c74eb2a174c124ea4adc; exit=0; EXPECT=matched; output-sha256=89febce0ebd4f02277ad1ee673694cd5e534d0002a7860276e444c8ae86f3ec1; output-bytes=3916; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R3: SC-2 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-2
  EXPECT: VERIFY root SC-2 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=0e69a5250af65819bc1d1d48e89deb845d98fc4ddfac05d4ea0af7dbb86e8f03; exit=0; EXPECT=matched; output-sha256=0a02ae61c62afc72daa3670461c7335a7511e25da7e4d5aa33c7e05a235a6257; output-bytes=4870; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R4: SC-3 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-3
  EXPECT: VERIFY root SC-3 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=78079c17d0b1d95add677e6578e1912c0d30d64af6e0659adbfbf54aeecb7042; exit=0; EXPECT=matched; output-sha256=68b85d9a78eea637450022eb44dd56b92f7369fe1f92832459b572b2bbb3dcc9; output-bytes=3732; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R5: SC-4 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-4
  EXPECT: VERIFY root SC-4 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=5cd20beee7c41d10823dbc71cda005242ba5a0e47876e80bb07fbd3dbfbaee0f; exit=0; EXPECT=matched; output-sha256=4c50317d35bf15759689f20b1da1b921243d1ab1ff855c5005a7e8dceb8ec55f; output-bytes=3777; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R6: SC-5 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-5
  EXPECT: VERIFY root SC-5 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=94ca0d0e5e4af459d9090f444743fbcb1fccc643cd253c773ed9fabe7cd76ced; exit=0; EXPECT=matched; output-sha256=3a24e5dec60b363186d11c743a3fe51532e3e66dc75884d6d7ebbb85ac9b0e07; output-bytes=4352; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R7: SC-6 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-6
  EXPECT: VERIFY root SC-6 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=43667c4888cb0630bba6dde0c79044762c2b0ee3ca2d53cc8d8502e1c11cde0e; exit=0; EXPECT=matched; output-sha256=dd106b732807d1ba3e2356d38bdbb4488ec1533ad2db094ad0b994a8333c2b38; output-bytes=3540; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R8: SC-7 passes on a fresh docker compose up with seeded data
  CHECK: node scripts/verify/root.mjs --gate SC-7
  EXPECT: VERIFY root SC-7 PASSED
  EVIDENCE: automatic-evidence=v1; definition-sha256=6abc98dffb16b695ac9f68a8f2684e16eec423d4c6fd3e2ec250f8afb19a0b6f; exit=0; EXPECT=matched; output-sha256=c7a161762c11ae1028bf9ad3013b4ed4a9f0c23905728063bca42499717096c4; output-bytes=3832; shell=/bin/sh; cwd=/home/user/mealplanner; path=ad9aca3d1be2/14 entries

- [x] R9: owner requests and spec r2 reread; every contract row reconciled by the architect
  EVIDENCE: architect review 2026-09-30 at 4cf7495: docs/build/R9-REVIEW.md (19 owner requests against gate evidence: 17 met, 1 met with a recorded interpretation (carbs "+-56" read as ±5 g), 1 deviation (native app phase B, OQ-3); SPEC-Q-6, ARC-4 and PRD-4's unmeasured 5 minutes listed) and docs/build/CONTRACT-INVENTORY.md (165 IDs reconciled; partial and manual-only clauses listed)
