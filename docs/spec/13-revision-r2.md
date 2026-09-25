# 13 — Revision r2: decisions from the UI mockups

Source: the owner-reviewed mockups in `docs/mockups/`. There is one `.dc.html` file per screen, and `docs/mockups/canvas.json` lists every screen with its title. Each file is self-contained HTML with inline styles, so open it directly in a browser; it references a `support.js` that is not in the repo, so interactive bits may not run. The mockups are the **visual and interaction reference**. Where this file and an earlier spec file disagree, **this file wins**.

Screen names below are mockup file names.

## 1. Onboarding: at most five questions (R2-ONB)

- **R2-ONB-1.** Onboarding asks **at most 5 questions** (`Onboarding.dc.html`). Nothing else is asked before the first plan unless the user chooses to add detail.
  1. Who eats at home? This is one free-text line of names and ages.
  2. Who follows macro targets? Numbers go in any format, or are pasted from a coach.
  3. What does a normal week look like? These are tap cards: kids at school (who, days), lunch at work (who, days), someone trains (who, days, morning/evening), snacks (on by default).
  4. What food does the family love? The user taps cuisine stickers.
  5. Anything anyone must never eat? This is plain text.
- **R2-ONB-2.** Every question can be skipped. Skipping applies the defaults.
- **R2-ONB-3. Inference engine.** A pure function `inferSetup(answers) → { changeOps, explanations }` in `packages/core/src/onboarding/` turns the answers into the full configuration as change-set ops (AGT-6 registry). Each explanation shows the source answer and links to the screen where it can be adjusted. Required inferences:
  - **Members:** adult/child from age. Starting appetite from age (≥ 14 large, 8–13 medium, < 8 small).
  - **Targets:** parse free-form numbers (`2150 cal, 180p 200c 70f`, `1655 / 130 / 160 / 55`, pasted text). Default sat-fat cap = 10 % of kcal. Default tolerance P ±5 / C ±5 / F ±2 / kcal ±50 (see OQ-1/OQ-2).
  - **Week:**
    - School → `packed_school_lunch`, shared among the named kids, cold, replaces lunch on those days.
    - Work → `packed_work_lunch`, individual, reheat available.
    - Training → a training schedule plus pre/post-workout individual slots. Keep the same daily totals and bias carbs to the pre/post slots (the training profile is only created if the user asks).
  - **Cuisines:** household-level +0.5 preferences.
  - **Never-eat:**
    - Parse into exclusions with `reason`.
    - Allergies are hard. Allergens expand through the catalogue's `dietary_flags`: sesame → tahini, hummus, za'atar, and any ingredient flagged `contains_sesame`.
    - Religious rules ("no pork or alcohol") are household-level hard exclusions covering sauces and marinades.
  - Free text is parsed with Claude using structured output. The parse result is shown for confirmation. The **deterministic** part (expanding allergens by flags, building ops) never depends on the model.
- **R2-ONB-4.** The flow ends on a "Here's what I worked out" review screen. It lists every inferred setting with *Adjust*, plus optional "go deeper" links. Nothing is saved until the user confirms. After that, one change set is applied, which can be undone.
- **R2-ONB-5.** The conversational path (`ChatOnboarding.dc.html`) produces the same `inferSetup` input and ends on the same review.
- **R2-ONB-6. Follow-up questions** (`FirstDaysPhone.dc.html`) are only for things the five answers cannot settle, for example nut-free school, meal times, or higher calories on training days. They are optional, shown at most one per day as one-tap cards, and dismissible. A "Getting set up" checklist tracks progress.

## 2. Detail levels: one control everywhere (R2-DL)

This supersedes the "Add detail" affordance in UX-2 (`DetailLevels.dc.html` is the interactive reference).

- **R2-DL-1.** Every configurable section has the same segmented control, **Basic · Detailed · Expert**, in its header. It is scoped to that section and that member, and persisted per (member, section).
- **R2-DL-2.** A one-line hint under the control says what the next level adds.
- **R2-DL-3.** Automatic values are **always visible** with an `auto` tag. They are never hidden behind a level.
- **R2-DL-4.** At Detailed or higher, tapping an auto value overrides just that value. It becomes `yours` and gets a "Back to auto" action. Sibling values rebalance where a sum is constrained (meal shares total 100 %).
- **R2-DL-5.** Lowering the level when overrides exist asks: **Keep them, just hide** or **Reset to automatic**. The data model stores overrides independently of the level shown.
- **R2-DL-6.** Every section also offers "tell the assistant", which applies the change at the right level.

## 3. Meals: shared or individual (R2-MEAL)

- **R2-MEAL-1.** Every slot is explicitly **Shared** (one dish for all attendees, portioned and variant-chosen per person) or **Individual** (each attendee gets their own dish). The Meals & schedule screen groups slots under these two headings. Each slot has a Shared/Individual switch (`ScheduleGrid.dc.html`).
- **R2-MEAL-2. One-off overrides for a single date** (`SwapDialog.dc.html`):
  - (a) Take one or more people out of a shared meal, so they get their own dish.
  - (b) Make the whole meal individual for that date.

  New table **meal_override** — plan_date, slot_type_id, kind (`split_member` | `make_individual`), member_ids uuid[], created_by. The planner honours it (PLN-11). The week plan labels every row SHARED/INDIVIDUAL and marks split members ("+ Omar: own dish").

## 4. Accounts and administration (R2-ADM)

- **R2-ADM-1. Sign in.** Email + password, one-time email link, or an invite code (`SignIn.dc.html`). Password reset by email.
- **R2-ADM-2. Invites.** An invite is bound to a role and (optionally) a member, and sent as email, copy link or QR code. Expiry is 24 h, 7 d (default) or 30 d. It is single use. Resend and revoke are available (`InviteDialog.dc.html`, `InviteAccept.dc.html`).
- **R2-ADM-3. People & access** (`PeopleAccess.dc.html`):
  - list of logins with the member they eat as, role, status (`active` | `invited` | `blocked`), and last active;
  - inline role change;
  - an actions menu: open the family profile, send a password reset, sign out of all devices, link to a different member, block, remove;
  - a separate list of members without a login.
- **R2-ADM-4. Block vs remove** (`BlockDialog.dc.html`):
  - **Block** revokes all sessions immediately and prevents sign-in. It is reversible, and meals and reviews continue.
  - **Remove** deletes the household_user link. It optionally archives the member.
  - Both take an optional admin-only reason and are logged as change sets.
  - The last admin can never be blocked, removed or demoted.

  New column `household_user.status` and `household_user.blocked_reason`.
- **R2-ADM-5. Account screen** (`AccountPhone.dc.html`):
  - profile, change password;
  - optional two-step sign-in (TOTP), which the household can require for admins;
  - active sessions with per-session sign-out;
  - notification preferences;
  - delete my account.
- **R2-ADM-6. Household settings** (`HouseholdSettings.dc.html`):
  - name, area, time zone, units;
  - visibility: members see each other's plates and targets; the kitchen sees names; members can review for younger siblings;
  - assistant: may apply requested changes; AI recipes auto/ask/never; insight check-in frequency;
  - default precision and sat-fat default;
  - data export (JSON + CSV);
  - delete household: a 14-day grace period that any admin can cancel, plus second-admin confirmation when there is one.
- **R2-ADM-7. Change log** (`ChangeLog.dc.html`):
  - filterable by area;
  - actor badges: user, assistant (you asked), proposal accepted by X, learned automatically;
  - per-entry Undo, disabled with an explanation when a later change conflicts.
- **R2-ADM-8. Platform operator console** (`PlatformConsole.dc.html`). It is a separate role `platform_operator`, outside households. It has:
  - households list (suspend/reactivate/delete);
  - user search with platform-wide block;
  - AI usage and cost;
  - failed jobs.

  Operators **cannot** read household data unless one of that household's admins grants time-limited support access. Every support view is logged in that household's change log.

## 5. Plans, kitchen, feedback: clarifications (R2-UX)

- **R2-UX-1.** Kitchen users can flag "ingredient unavailable" or "recipe unclear" on the cook sheet (`CookSheet.dc.html`). An unavailable flag triggers substitution through the knowledge graph (KG-4.3) and a plate re-solve, and the result is shown to admins (`TodayDesktop.dc.html`).
- **R2-UX-2.** The cook sheet shows the NUT-6 weigh-and-measure banner and a per-attendee allergy banner ("Zayd: no sesame. Plate his first, separate spoon.").
- **R2-UX-3.** The recipe page shows each component's preparation variants as tabs, with per-100 g cooked nutrition, ingredients for 1 kg cooked, method, and "Tonight: who gets which" (`RecipePage.dc.html`).
- **R2-UX-4.** The quick rating is a bottom sheet from a meal-time notification: 5 stars plus one-tap tags (`QuickRatePhone.dc.html`). The detailed review covers per-component tags, portion, frequency and comment, and "reviewing for" a younger sibling (`ReviewComposePhone.dc.html`).
- **R2-UX-5.** Emoji are **not** used as UI (this supersedes the emoji rating scale and emoji avatars in UX-5): the rating scale is drawn stars, avatars are coloured initials, and icons are inline stroke SVG (Lucide).
- **R2-UX-6.** The working product name in the mockups is "Mise". It is a placeholder, and the final name is an owner decision.

## 6. Success criteria added

- **SC-6.** A new household reaches its first generated day plan after answering at most 5 questions. Measured by Playwright, counting required inputs.
- **SC-7.** For every inferred setting, the review screen links to the place where it can be adjusted. Playwright checks every link resolves.
