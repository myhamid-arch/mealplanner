# 07 — Admin agent

The admin manages the product through a chat assistant that looks and behaves like ChatGPT or Claude. Anything the admin can do in the UI, they can ask the agent to do. The agent can also bring things to the admin's attention: insights, plan results and problems. Every change the agent makes is typed, validated, logged and undoable (AGT-1).

v1 exposes the agent to **admins only**. Members interact through reviews.

## 1. Model and loop (AGT-2)

- `@anthropic-ai/sdk`. The model comes from `ANTHROPIC_MODEL` (default `claude-opus-5`) with `thinking: {type: "adaptive"}` and `output_config.effort` from `AGENT_EFFORT` (default `high`). Refusal fallback: beta `server-side-fallback-2026-07-01`, `fallbacks: "default"`.
- The loop is a **manual streaming loop** on the server (`client.messages.stream(...)` + `finalMessage()`) so that:
  1. text deltas and tool activity stream to the browser over Server-Sent Events;
  2. every tool input is validated with its Zod schema before execution;
  3. write tools run through the change-set service with the admin's authority.
- Every client tool sets `eager_input_streaming: true`. Consequences: validate each parsed input with Zod; on failure return `is_error` with `INVALID_JSON`; catch only the SDK JSON-parse error, and rethrow typed API errors. Stop without running tools on `refusal`, and on `max_tokens` when a `tool_use` is present. Resume on `pause_turn`.
- Parallel tool calls are allowed. All `tool_result`s go back in a single user message.
- Iteration cap: 12 model calls per user turn. On reaching the cap, the agent reports what it did and what is left.

## 2. Context (AGT-3)

- **System prompt** (stable, cached):
  - Role: the household's meal-planning assistant.
  - Principles: macros first, then appeal, then ingredient economy, per the household's weights. Never invent nutrition numbers; call tools for them. Present choices as proposals. Keep answers short. Show numbers in tables.
  - When to use `apply_change` vs `propose_change` (§3).
  - Formatting rules for the chat UI.
- **Household digest.** A compact snapshot: members (name, targeted?, targets summary), active slots, weights, pending proposal count, and today's plan status. It is appended as a text block **in each user turn**, after the cached prefix, so the prefix is not invalidated.
- **History.** Stored append-only as the exact content blocks returned by the API (thinking blocks included) and replayed verbatim. Never edited or reordered. Long conversations use server-side compaction (beta `compact-2026-01-12`). The full `response.content`, compaction blocks included, is appended every turn.
- Member names are sent to the model in chat, because the admin talks about people by name. Recipe generation and insight synthesis use pseudonyms ([05-recipe-generation.md](05-recipe-generation.md) §3).

## 3. Tools (AGT-4)

All tools are household-scoped by the server session. The model never passes a household id.

**Read**

| Tool | Purpose |
|---|---|
| `get_household` | Members, targets, tolerances, slots, schedules, weights, presets |
| `get_plan` `{from, to}` | Plan days → meals → plates with fit status and macros |
| `explain_meal` `{planMealId}` | Score breakdown, the plate solutions, alternatives considered |
| `search_dishes` `{query?, cuisine?, slot?, ingredient?, limit}` | Library search |
| `get_dish` `{dishId}` | Full recipe, variants, nutrition per 100 g, reviews summary |
| `get_reviews` `{target?, memberId?, since?, minRating?, maxRating?, limit}` | Review feed |
| `get_preferences` `{memberId?}` | Learned and explicit preferences with evidence counts |
| `get_proposals` `{status?}` | Pending and recent proposals |
| `get_change_log` `{limit}` | Recent change sets |

**Actions**

| Tool | Purpose |
|---|---|
| `generate_plan` `{from, to, keepLocked: true}` | Enqueues a plan job. Returns the job id. Progress events stream into the chat. |
| `suggest_alternatives` `{planMealId, instruction?}` | Top 5 alternatives, optionally steered by text through the scorer, and AI generation if `instruction` asks for something new |
| `create_recipe` `{request, slot?, count?}` | [05-recipe-generation.md](05-recipe-generation.md) §6. Returns draft recipe cards. |
| `run_insights` `{}` | Runs the insights engine now |

**Changes**

| Tool | Purpose |
|---|---|
| `apply_change` `{summary, ops: ChangeOp[]}` | Applies immediately. Only for changes the admin explicitly asked for in the current turn. Returns the change-set id and an Undo card. |
| `propose_change` `{title, rationale, evidence?, ops: ChangeOp[]}` | Creates a pending proposal card. The agent's own ideas always go here. |
| `undo_change` `{changeSetId}` | Applies the inverse |

**Protected operations (AGT-5).** Protected ops are always turned into a proposal, even when sent through `apply_change`. The server enforces this; it is not left to the prompt. They are:
- removing or relaxing an allergy exclusion,
- loosening a tolerance,
- archiving a member,
- deleting a dish that has reviews,
- changing a role,
- any op marked `protected` in the registry.

The admin can switch "Let the assistant apply changes I ask for" off in Settings. With it off, every change becomes a proposal.

## 4. Change operations (AGT-6)

A single registry (`packages/core/src/changes/registry.ts`) defines each op with: a Zod payload schema, a `protected` flag, a `describe(payload, state)` function for human-readable diffs, an `apply(tx, payload)` function, and an `inverse(stateBefore, payload)` function. The UI forms, proposals, insights and the agent all use this registry. There is **no other write path** (DM-6).

v1 ops:

`household.update`, `member.create`, `member.update`, `member.archive`*, `target.set`, `tolerance.set` (*when looser), `training.set`, `day_override.set`, `slot.create`, `slot.update`, `slot_schedule.set`, `distribution.set`, `slot_target.set`, `weights.set`, `preset.upsert`, `preset.delete`, `preference.set`, `preference.reset`, `exclusion.add`, `exclusion.remove`*, `frequency.set`, `adjusters.set`, `dish.create`, `dish.update`, `dish.retire`*, `ingredient.create`, `ingredient.verify`, `plan.lock`, `plan.unlock`, `plan.swap_dish`, `plate.override`, `role.set`*

(* = protected, fully or conditionally)

**Undo semantics.** Applying an inverse creates a new change set linked by `undone_by_change_set_id`. An undo is refused, with a conflict message, if a later change set touched the same entities. The agent can then propose a manual resolution.

## 5. Chat UI contract (AGT-7)

Message rendering:
- Assistant text is streamed Markdown (tables supported).
- **Tool activity chips** such as "Checking next week's plan…" and "Solving portions for 4 people…", which collapse into a "Details" disclosure.
- **Cards**, rendered from structured tool results rather than parsed from text:
  - `proposal`: title, rationale, before→after diff from `describe`, evidence links (reviews), Accept / Reject (with optional reason) / Edit (opens the same ops in a form).
  - `applied_change`: summary, diff, Undo, plus a timestamp.
  - `plan_day`: a compact day view with per-member fit badges.
  - `recipe`: dish summary, variants, per-attendee example plates, Save / Discard.
  - `macro_table`: member × slot targets vs actuals.
  - `job_progress`: a live plan-generation or insights progress bar.
  - `insight_digest`: grouped proposals from the insights engine.

Other chat behaviour:
- **Proactive messages.** Insight digests and job completions are inserted as `event` messages into the admin's most recent conversation, or a new "Updates" conversation, with a badge on the chat button.
- **Composer.** Multiline input, suggestion chips based on state (e.g. "Plan tomorrow", "Why is Omar's lunch off target?", "Review 3 pending proposals"), voice input via the browser speech API where available, and a stop button during streaming.
- Conversation list with auto titles. Search.
- Every admin page has the chat as a **side panel** on desktop (≥1024 px), toggled by a floating button. On mobile it is a full-screen sheet. The panel knows the current screen (for example, the dish being viewed) and passes it as context in the user turn.

## 6. Persistence and replay (AGT-8)

- `chat_message.content` stores the API content blocks verbatim. Display text is derived.
- Tool results store both what was sent to the model and the card payload for the UI.
- Conversations are never edited. A "regenerate" action appends a new turn; it does not rewrite history.

## 7. Evaluation (AGT-9)

The repo ships a small eval set (`evals/agent/*.yaml`, ≥ 25 cases), for example "Set Sara's protein to 140 g", "Why is dinner off target for Omar?", "Make weekends more about appeal", "Omar is allergic to sesame". Each case has expected tool calls and op kinds, and must-not-happen checks (e.g. no `apply_change` for a proactive suggestion; the allergy op is `exclusion.add` with `hard`). The eval runs against a live model only when `RUN_LLM_EVALS=1`. It is not part of CI, because it costs money.
