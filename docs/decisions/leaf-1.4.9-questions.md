# Leaf 1.4.9: spec questions

Each question records the reading this leaf builds on. The more conservative reading is chosen
where the spec leaves room (BLD-7 rule 6).

## SPEC-Q-1: which change sets are "done automatically" (G1)

11 §8 R-61 says "the `learning` change sets applied since the household's previous digest"; the
architect's note narrows it to "those applied automatically by review learning (FBK-5
`portion_bias.set`)". In the merged code `source = 'learning'` is also written by every worker job
that acts as the system (`plates.resolve`, `plates.substitute`, `recipe.generate`, `recipe.revise`,
a plan job with no user), and review learning writes one `learning` change set per review, mostly
`preference.set` score updates.

Reading: the digest lists change sets with `source = 'learning'`, `actor = 'system'` whose forward
ops include at least one `portion_bias.set` (the FBK-5 portion moves, the example the mockup
shows). Preference-only review learning and the system jobs above are not listed. A user
(`ui`), agent (`agent_apply`) or accepted-proposal (`proposal_accept`) change set is never listed
(the negative control).

## SPEC-Q-2: the title of an automatic change (G1)

ChatPhoneDigest: "Zayd's rice portion is 10% smaller after 2 "too much" ratings." A portion bias
is per member and component role, not per dish, and each change set comes from one review.

Reading: the title is built from the change set's `portion_bias.set` ops and their before-images:
"<member>'s <role> portion is <n>% smaller|larger" (roles joined with "and", "portions are" for
several), with n = round(|after / before − 1| × 100). The change set's own summary ("Learned from
Zayd's review of …") follows as the second line. A change set whose ops cannot be read falls back
to its summary alone.

## SPEC-Q-3: "since the previous digest" (G1)

Reading: the lower bound is the `created_at` of the household's latest stored `event` row that
carries an `insight_digest` card (any conversation), read before the new digest is inserted. With
no previous digest, every qualifying change set so far is listed. A digest with automatic changes
but no proposals or notes is worth posting (`digestHasNews` counts them). An item already undone
when the digest is posted is stored with `undone: true`; the card reads the live undo state from
the change log, as the `applied_change` card does.

## SPEC-Q-4: where the plan-ready row goes (G2)

G2 says "the admin's Updates conversation". AGT-7 (07 §5): proactive messages go "into the
admin's most recent conversation, or a new 'Updates' conversation", which is what the digest
already does (`conversationFor`).

Reading: a `plan.generate` job whose payload has no `conversationId` posts, when it succeeds, to
each active admin through the same `conversationFor` as the digest. Failed or cancelled jobs that
no agent turn started post nothing (as today). Agent-started jobs keep 1.3.5's behaviour: one
message in the starting conversation, content unchanged.

## SPEC-Q-5: the plan-ready card (G2)

AGT-7 lists the card types and 1.4.5 G3 checks that list, so no new type is added.

Reading: `job_progress` gains an optional `ready` object {title, facts, href, action}; with it,
a succeeded card draws the ChatPhoneDigest row (title, facts joined by " · ", link) instead of the
progress bar. The event's text is empty (the card carries the title). Facts, all from the job
result:
- "All meals on target" when every targeted plate is `in_tolerance`, else "<n> meal(s) off target"
  (no fact when the plan has no targeted plates);
- per packed slot type, "<n> <slot label, lower case, plural>" ("3 packed school lunches");
- for meals in training slots (`slot_type.is_training_slot`), "<names>'s training-day meals
  included".
Title: one date "Monday's plan is ready"; several "The plan from Monday to Sunday is ready". The
link reads "Look, then send to kitchen" and opens `/plan?week=<first date>`.

## SPEC-Q-6: "me" and relation phrases in the deterministic parse (G3)

Reading:
- A person written as "me", "myself", "I" or "I'm" is the viewer. `parsePeople` has no viewer name
  and keeps the typed word; `inferSetup` names that member `ctx.adminName` and resolves the same
  word wherever answers refer to a person (targets, week, never-eat).
- A possessive or article (my, our, his, her, their, the) with an optional count ("three", "3")
  and a relation word (wife, husband, partner, spouse, son, daughter, kid, child, boy, girl, twin,
  baby, mum/mom/mother, dad/father, brother, sister, grandma/grandpa, step-…, plural forms) is
  removed wherever it stands in a person's words; a bare plural relation word ("kids: Layla 18")
  is removed before a name. A bare singular word is kept: F1's "Child C1" and "Grandpa" stay
  names.
- A relation phrase with no name after it ("my wife 39") keeps the relation word as the name
  ("Wife"), so no one is dropped. An age-only piece that follows a named person without an age
  ("Sara, my wife, 39") is that person's age.
- Relation words do not set sex (not asked for).
