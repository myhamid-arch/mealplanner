# leaf-1.3.5 spec questions

Each question records the reading taken (the more conservative one) and continues on it. Items marked **needs ruling** touch files outside this leaf's OWNS; they are also listed under "Requests" in the PR.

## SPEC-Q-1: where the tool adapters live — needs ruling (OWNS)

R-2 forbids `ai` importing `db`; services reach `ai` by dependency injection wired in `apps/*`. The agent loop and every tool's logic (Zod input, protected-op → proposal conversion, cards) live in `packages/ai/src/agent/**` behind an `AgentPorts` interface. The ports themselves (one thin function per tool over `@mealplanner/db` services and 1.4.1's `apps/web/lib/server/{reads,plans,feedback,changes,jobs}.ts`, plus the Claude client from the environment) need a file in `apps/web`. This leaf owns only the route file there, and ARC-4 keeps business logic out of route handlers.

Reading: request `apps/web/lib/server/agent.ts` (new file) in OWNS. It holds the ports, `agentModel()` (built from `resolveClaudeConfig`, null without a credential) and `useAgentModel(model)` (test injection, the same pattern as `useRuntime`). The route stays a thin `route(...)` call.

## SPEC-Q-2: the POST endpoint in the contract and 1.4.1's G1 — needs ruling (files)

1.4.1's G1 enumerates route files against `ENDPOINTS` and asserts the chat POST is absent (`g1-contract-matrix.int.test.ts:81`); its negative control uses the same route as its "unregistered" example (lines 304–305). Adding the route breaks both unless the contract and the test change with it.

Reading, requested as single-entry edits:
- `packages/api-contract/src/contract/endpoints.ts`: endpoint `conversationsSend` (`conversations.send`, `POST /api/v1/conversations/{id}/messages`, household, `ADMIN`, `params: byId`, body `ChatSendBody`, `format: "sse"`, response `ChatStreamEventDto`, errors `[409, 429, 503]`) and its `ENDPOINTS` entry.
- `packages/api-contract/src/contract/dto.ts`: `ChatSendBody` and `ChatStreamEventDto` (SPEC-Q-12).
- `apps/web/test/api/g1-contract-matrix.int.test.ts`: line 81 removed (the route now exists and is registered); lines 304–305 use a fabricated route (`"DELETE /api/v1/weights"`) as the unregistered example.
- `apps/web/test/api/support/cases.ts`: one case for `conversations.send` (success with an injected stub model; `useAgentModel` from SPEC-Q-1).

1.4.1 G1–G3 are shown passing on this branch at CP2.

## SPEC-Q-3: what is stored per turn, and how it is replayed (AGT-8, G3)

`chat_message.role` is `user | assistant | tool | event`; the API only knows `user` and `assistant`.

Reading:
- `user`: the exact `content` array of the user message sent to the model: the admin's text, a text block with the screen context when the panel passes one (07 §5), and the household digest text block last (AGT-3). Nothing is added at replay time.
- `assistant`: one row per model call, `content` = the response's `content` verbatim (thinking, compaction and fallback blocks included).
- `tool`: `{ "results": [tool_result blocks exactly as sent], "cards": [...] }`; replay sends `results` as one user message (AGT-2: all results of one assistant message in one user message).
- `event`: proactive messages (SPEC-Q-9). Not sent to the model; the digest carries the counts the model needs (pending proposals).

Replay = rows in `(created_at, id)` order, `event` rows skipped, each mapped as above, compared byte-for-byte in G3 with the request bodies the stub model received. `created_at` is strictly increasing within a conversation (SPEC-Q-11 serialises turns).

## SPEC-Q-4: invalid tool JSON (AGT-2, G1)

With `eager_input_streaming`, two failures can occur: (a) the SDK cannot parse the accumulated JSON at all and throws `AnthropicError` ("Unable to parse tool parameter JSON …") while the stream is consumed; (b) it parses (tolerantly) but the input fails the tool's Zod schema.

Reading: (b) the tool is not run; its `tool_result` is `is_error: true` with content `{"INVALID_JSON": <the received input as JSON>}` built with `JSON.stringify`, and the loop continues. (a) there is no final message and no `tool_use_id` to answer, so the same request is re-issued, at most 2 times, and counts against the 12-call cap; a third failure ends the turn with an error event. Only that SDK error is caught (`AnthropicError` that is not an `APIError`, raised while the stream is consumed); typed API errors are mapped by 1.3.1's `fromSdkError` and end the turn.

## SPEC-Q-5: stop reasons that leave a `tool_use` unanswered (AGT-2)

History must stay valid for the next request: an assistant message ending in `tool_use` must be followed by its `tool_result`s.

Reading:
- `refusal`: the assistant row is stored; no tool runs. If it carries `tool_use` blocks, a `tool` row answers each with `is_error: true` ("not run: the response was refused"). The turn ends with a `refusal` event (category from `stop_details`).
- `max_tokens` with a `tool_use`: same, "not run: the response was cut off at max_tokens". Without a `tool_use`, the text is kept and the turn ends with a `max_tokens` event.
- `pause_turn`: the assistant row is stored and the request is sent again with it appended (no extra user message); counts against the cap.
- `end_turn`: the turn ends.

## SPEC-Q-6: the iteration cap (AGT-2)

"On reaching the cap, the agent reports what it did and what is left." Reading: the 12th call is the last. If it still asks for tools, they are not run (`is_error` "not run: the 12-call limit for this turn was reached"), and the turn ends with an `event` row whose card is `iteration_limit`: the tools that ran (name, ok/error) and the tools left unrun. It is deterministic (no 13th call) and not replayed to the model (SPEC-Q-3).

## SPEC-Q-7: ops with dedicated endpoints (AGT-4, AGT-5)

1.4.1 refuses `access.*`, `support.*` and `role.set` on `POST /change-sets` because their endpoints also revoke sessions or check operators. Reading: `apply_change` and `propose_change` refuse `access.*` and `support.*` as a tool error naming the People & access screen. `role.set` is listed by AGT-5 as protected, so through `apply_change` it becomes a proposal (as every protected op, SPEC-Q-8); `propose_change` accepts it.

## SPEC-Q-8: how protected ops become proposals (AGT-5, G2)

Reading: `apply_change` calls `applyChangeSet` with `source: "agent_apply"`, `actor: "agent"`. 1.1.2's service refuses protected ops (and every op when `agent_may_apply` is off) with `ProtectedOperationError` before writing anything. The tool catches exactly that error and stores the same ops as one `agent_chat` proposal through `createProposals` (FBK-8 guardrails; not counted in the insight budget, R-33), with `conversationId` and the assistant message id; the result tells the model it became a proposal and why, and the card is `proposal`. The decision is the server's; the agent code never inspects the `protected` flag itself. G2 proves it against the real database with a stub model that sends each protected op kind through `apply_change`.

## SPEC-Q-9: proactive `event` messages (AGT-7, R-2/R-33)

Reading: a `worker` function posts an `event` row into the admin's most recent non-archived conversation, or creates an "Updates" conversation for that admin. Targets: every active admin of the household. Posted:
- after each `insights.run` that stored at least one proposal or note: card `insight_digest` (stored proposal ids, kinds, rationale; dropped reasons);
- when a job started by the agent (`generate_plan`, `run_insights`) finishes: card `job_progress` with the terminal status, posted into the conversation that started it (the job payload carries `conversationId`).

Needs a worker file and two single-line hooks (Requests R-D).

## SPEC-Q-10: `create_recipe` in the web process (REC-6)

The generator's database ports are wired in `apps/worker/src/ai.ts`, which `apps/web` cannot import. Reading: the web adapter builds the same ports (`recordAiGeneration`, `loadPlanPool`, `aiDishesToday` under the same advisory lock, the daily limit) and runs `generateRecipes` with `adminRequest` and `count` (default 1), **without saving** (REC-6: Save or Discard). The `recipe` card carries the surviving dish draft and per-attendee example plates; Save applies `dish.create` through `POST /change-sets` (1.4.5). No credential, or over the limit: the tool returns the reason (REC-2).

## SPEC-Q-11: concurrent turns on one conversation

Reading: a turn holds `pg_advisory_lock(hashtext('chat:' || conversation_id))` on a dedicated connection for its whole run; a second POST to the same conversation while one runs gets `409 turn_in_progress` (try-lock). This keeps rows strictly ordered (SPEC-Q-3). The chat rate limit (30 turns/hour, 1.4.1 `chatRateLimit`) and the credential check (`503 assistant_unavailable`) run before anything is stored.

## SPEC-Q-12: the SSE stream of a turn

Reading: `event:` names and `data:` objects (`ChatStreamEventDto`, a discriminated union):
- `message` — a stored row (`ChatMessageDto`) as soon as it is appended (user, assistant, tool, event);
- `text_delta` — `{ text }`; `thinking` — `{}` (activity only; thinking text is not shown);
- `tool_start` — `{ toolUseId, name, label }` ("Checking next week's plan…" chips); `tool_done` — `{ toolUseId, ok, card? }`;
- `error` — `{ code, message }`; `done` — `{ stopReason, modelCalls }` (terminal).
Client disconnect aborts the model stream; rows already appended stay.

## SPEC-Q-13: the `ai_generation` audit row (DM-7)

Reading: one row per model call, `purpose: "chat"`, `model` = served model, `request_summary` = conversation id, model call index, message count, tool names (no history text, no credentials), `response_raw` = the response content, usage and `stop_reason`. A call that fails with an API error writes a row with the error code as `stop_reason`.

## SPEC-Q-14: exclusion keys written by the agent (R-36, R-34)

Reading: for `exclusion.add` / `exclusion.remove` with `kind = ingredient`, the tool checks that `key` is a catalogue ingredient **slug**; an ingredient id or unknown key is a tool error that names the slug to use (resolved from the catalogue when the id exists). Every exclusion filters whatever `hard` (R-34), so the agent never uses `hard: false` to mean "soft". An allergy is `exclusion.add` with `reason: "allergy"`, `hard: true` (AGT-9).

## SPEC-Q-15: `reviews.extract` storage and "marks review processed" (ARC-7, R-40) — needs ruling (schema)

ARC-7: the job "extracts implicit tags from free text …; marks review processed". `review.processed_at` is already the insights run's marker (1.3.3: `insightsDue` counts `processed_at IS NULL`, the run sets it). If extraction set it, reviews would never trigger or feed an insights run. 02 has no column for extracted tags, and `review.tags` is the author's own (edits kept in `review_revision`).

Reading (proposed, needs a schema grant under R-9): `review.extracted_tags text[] not null default '{}'` and `review.extracted_at timestamptz` in migration `0005_review_extraction.sql`. The job (`apps/worker/src/jobs/reviews-extract.ts`):
1. skips replies, reviews without a comment and reviews already extracted;
2. calls `extractReviewTags` (`packages/ai/src/reviews/**`, structured output, effort `low`, pseudonymised: member names scrubbed as in REC-3), which may return only FBK-3 vocabulary tags that the author did not already give;
3. writes `extracted_tags`, `extracted_at` and applies the learning delta of the added tags as one `learning` change set (1.3.2 `planLearning` with the author's tags as `previous` and tags ∪ extracted as current), so learning uses the extracted signal exactly as an edit would;
4. never touches `processed_at`.
Consumers that should see extracted tags (1.3.3 rule inputs in `load.ts`) are the owners' single-line change; until granted, extraction affects learning only. Without a schema grant, this leaf builds the module and job with step 3's learning and the `ai_generation` row, storing the result as the job result only, and says so at CP2.

## SPEC-Q-16: the eval set (AGT-9, G4)

Reading: `evals/agent/cases/*.yaml` (≥ 25 cases, schema checked by a unit test that runs in CI), and `evals/agent/run.ts`, which runs the real loop against a live model only when `RUN_LLM_EVALS=1`, with in-memory ports over fixture F1 (tools return fixture data; writes are recorded, not applied). A case passes when every expected tool call and op kind occurs and no must-not check fires; the score is printed. G4 stays a manual handoff: no credential here (architect note, 1.3.1 G4 precedent). Needs `js-yaml` (Requests R-F).
