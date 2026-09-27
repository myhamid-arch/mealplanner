# leaf-1.3.6: agent eval failures, transcripts and root causes (W-11, R-64, G2)

Source failure: `docs/build/live/leaf-1.3.5-G4.log` (2026-09-27T09:17:05Z, commit 61c3b5b, `claude-fable-5-1`): 26/29 = 89.7 % against 90 %. That run printed only tool names, so no transcript exists for it.

Diagnosis run: the three failing cases only, live, with the new `EVAL_TRANSCRIPTS` option of `evals/agent/run.ts` (the stored rows exactly as sent and received, plus the port writes).

- Command, time, exit and commit: `docs/build/live/leaf-1.3.6-diag-3cases.log` (2026-09-27T11:03:12Z, exit 1, commit dc61783 plus the uncommitted transcript option). Result 0/3.
- Transcripts: `docs/build/live/leaf-1.3.6-diag-allergy-sesame.log`, `docs/build/live/leaf-1.3.6-diag-weekend-appeal.log`, `docs/build/live/leaf-1.3.6-diag-make-sara-admin.log`.

Thinking blocks come back empty (`display` defaults to `omitted` on this model), so the evidence is the tool calls and the visible text.

## 1. allergy-sesame ("Omar is allergic to sesame")

**Transcript.** The model says "I'll confirm the ingredient slug before adding the exclusion", calls `search_dishes {ingredient: "sesame"}`, `search_dishes {query: "sesame"}`, `search_dishes {query: "tahini"}`, `get_dish` (beef kofta with tahini), then one `apply_change` with two ops:

```json
{"kind":"exclusion.add","payload":{"memberId":"…064","kind":"dietary_flag","key":"contains_sesame","reason":"allergy","hard":true}}
{"kind":"exclusion.add","payload":{"memberId":"…064","kind":"ingredient","key":"tahini","reason":"allergy","hard":true}}
```

Its answer: "Omar now has a hard allergy exclusion for sesame, set two ways so nothing slips through: anything flagged contains_sesame … tahini explicitly". The live 09:17 run shows the same tool sequence and the same failure.

**What the grader expected.** `exclusion.add` with `{kind: ingredient, key: sesame-seeds, reason: allergy, hard: true}`.

**Root cause.** The expectation and the spec disagree on how a sesame allergy is represented. The model's `dietary_flag` op is the spec's representation:

- 13 R2-ONB-3 (13 overrides earlier files): "Allergies are hard. Allergens expand through the catalogue's `dietary_flags`: sesame → tahini, hummus, za'atar, and any ingredient flagged `contains_sesame`."
- The deterministic onboarding resolver encodes the same sentence as `["sesame", "contains_sesame"]` → a `dietary_flag` exclusion (`packages/core/src/onboarding/resolve.ts:1-12`). The agent and onboarding would otherwise store the same allergy in two different shapes.
- An ingredient exclusion keyed `sesame-seeds` excludes only that ingredient. The planner reads ingredient keys and dietary flags separately (`packages/core/src/planner/select/members.ts:47`). The catalogue flags six ingredients `contains_sesame` (`data/ingredients.v1.json`: halva, hummus, sesame-oil, sesame-seeds, tahini, zaatar). With only the expected op, tahini, hummus, sesame oil, za'atar and halva would still reach Omar's plate.
- 07 §7 states the must-not check as "the allergy op is `exclusion.add` with `hard`". It does not name the kind or the key.

A second contributing cause is in the system prompt: its only allergy example is an ingredient key ("sesame-seeds"), and it does not state the R2-ONB-3 rule. The model reached the flag on its own and then added tahini because it was unsure what the flag covers.

**Fix (prompt, `packages/ai/src/agent/prompt.ts`).** State R2-ONB-3: an allergen that has a catalogue dietary flag (sesame, nuts, gluten, dairy, egg, fish, shellfish, soy) is one `exclusion.add` with `kind: "dietary_flag"`, the flag key, `reason: "allergy"`, `hard: true`, which covers every flagged ingredient. Other foods are ingredient exclusions keyed by slug.

**Expectation.** Changed by architect ruling **R-66** (SPEC-Q-1, ruling A; `docs/spec/11-build-plan.md` §8) to `{kind: dietary_flag, key: contains_sesame, reason: allergy, hard: true}`, with the `hard: false` must-not kept. This is the only expectation that changed. The YAML comment cites R-66, and G2 checks every other case against the failed set at 9d23db6.

## 2. weekend-appeal ("Make weekends more about appeal")

**Transcript.** "I'll check the current presets first." `get_household` (no presets), then:

```json
{"kind":"preset.upsert","payload":{"name":"Weekend","values":{"macroPrecision":1,"appeal":0.9,"ingredientEconomy":0.4,"variety":0.3,"fairness":0.5},"appliesToWeekdays":[6,0]}}
```

The model's answer says the preset "applies on Saturdays and Sundays (the UAE weekend)". The 09:17 run instead stopped after `get_household` with no change op. Its text was not logged, and this run did not reproduce it.

**What the grader expected.** `preset.upsert` with `appliesToWeekdays: [5, 6]`.

**Root cause.** The day numbering was never given to the model. Weekdays are `0 = Monday … 6 = Sunday` everywhere in the domain model (`packages/core/src/types/enums.ts:238`, `weekdayOf`; F1 trains Adult A "Mon/Wed/Fri" as weekdays 0/2/4). The op reference in the system prompt renders each weekday as an integer 0–6 with no convention (`preset.upsert`, `training.set`, `slot_schedule.set`, `day_override`). The model meant Saturday and Sunday and used JavaScript's `getDay` numbering (0 = Sunday). The server would have stored a preset for **Sunday and Monday**. The eval's `[5, 6]` is correct. This is a real defect, not an eval artefact.

The earlier no-op run is consistent with the same gap. A model unsure how to name Saturday and Sunday can read the household and then stop or ask. That is an inference, because the text was not logged.

**Fix (prompt).** State the convention next to the op reference: "Weekdays are integers 0 = Monday, 1 = Tuesday … 5 = Saturday, 6 = Sunday." Also state that `preset.upsert` with `appliesToWeekdays` is how weights change for particular days of the week. No expectation change.

## 3. make-sara-admin ("Make Sara an admin too")

**Transcript.** No tool call. Answer: "Roles and access are managed on the People & access screen, not through me. To make Sara an admin: Open People & access …".

**What the grader expected.** A `role.set` op with `role: admin`. Through `apply_change`, the server turns it into a proposal (AGT-5).

**Root cause.** The system prompt tells the model not to do it: "People, roles and access, and support access, are managed on the People & access screen, not by you." (`packages/ai/src/agent/prompt.ts`). That contradicts the spec:

- 07 intro: "Anything the admin can do in the UI, they can ask the agent to do."
- 07 §3 AGT-5 lists "changing a role" among the protected operations that "are always turned into a proposal, even when sent through `apply_change`".
- 07 §4 AGT-6 lists `role.set`* among the v1 ops.

The op reference in the same prompt does include `role.set (protected)`, so the model got conflicting instructions and followed the explicit prose. The sentence was written for the ops that do stay out of the agent's reach: `access.*` and `support.*` (leaf 1.3.5 SPEC-Q-7, `DEDICATED_PREFIXES` in `packages/ai/src/agent/tools/run.ts`). Its wording also covered roles.

**Fix (prompt).** Replace the sentence. A role change is `role.set` with the login's `userId` from `get_household` (`logins`), sent through `apply_change`, where it becomes a proposal the admin confirms. Invitations, blocking, removing logins, sessions and support access stay on People & access. No expectation change.

**Open outside OWNS.** The eval household's `get_household` returns `logins` with user ids. The production port (`apps/web/lib/server/agent.ts:160`) does not, so in the app the model cannot name Sara's `userId`. A single-entry request for that file is on the PR (ARCHITECT QUESTION after CP1). The eval result does not depend on it.

## Summary

| Case | Root cause | Fix | Expectation |
|---|---|---|---|
| allergy-sesame | Expectation disagrees with R2-ONB-3 on the allergy's shape; the prompt has no flag rule | prompt: R2-ONB-3 flag rule | changed per R-66 (SPEC-Q-1, ruling A) |
| weekend-appeal | Weekday numbering missing from the prompt; the model used 0 = Sunday | prompt: 0 = Monday … 6 = Sunday; presets for day-specific weights | unchanged |
| make-sara-admin | The prompt forbids role changes, contrary to AGT-5/AGT-6 | prompt: `role.set` through `apply_change` becomes a proposal | unchanged |
