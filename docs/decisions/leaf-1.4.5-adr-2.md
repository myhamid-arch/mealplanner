# Leaf 1.4.5 ADR-2 — chat client: streaming, Markdown, cards, voice

Status: accepted at CP1 (R-53); built as below.

## Streaming (AGT-2, AGT-7)

The composer posts through the contract client's `events(conversationsSend, …)` (`@mealplanner/api-contract/client`), which reads the `text/event-stream` body of a `POST` with `fetch` and parses each `data:` line with `ChatStreamEventDto`. `EventSource` is not used: it cannot `POST`. A reducer (`components/chat/turn.ts`) folds the events into the view: `message` (the stored user/assistant/tool/event rows, appended in order), `text_delta` (streamed assistant text), `thinking` (a "Thinking…" status), `tool_start` / `tool_done` (activity chips with the server's labels, collapsing into a "Details" disclosure when the turn ends; `tool_done.cards` render at once), `error` and `done`. The Stop button aborts the fetch (`AbortController`); the server releases the turn's lock on disconnect (R-46 SPEC-Q-11).

HTTP errors before the stream starts are separate states with their own copy and action (ApiProblem codes): `409 turn_in_progress` ("A reply to this conversation is still running", retry), `503 assistant_unavailable` ("The assistant isn't set up on this server"; composer disabled, screens still work), `429 rate_limited` ("You've used this hour's assistant turns"; the composer keeps the text).

Proactive `event` rows (digests, job completions) appear by re-reading `GET …/messages`: each `queued`/`running` `job_progress` card follows `GET /jobs/{id}/events` (SSE; plan jobs show the day being planned and the meals chosen) and the conversation is re-read when the job ends (the worker posts its completion row before the job's terminal event); otherwise it is re-read when the page becomes visible again and every 30 s while it is visible.

## Markdown (AGT-7 "streamed Markdown, tables supported")

No Markdown dependency is added (anti-drift 3). `components/chat/markdown.tsx` renders the subset the system prompt asks for — paragraphs, line breaks, `**bold**`, `*italic*`, `` `code` ``, bullet and numbered lists, headings (as bold lines), GFM pipe tables, and `[text](url)` links (http(s) and same-origin paths only) — into React elements. It never uses `dangerouslySetInnerHTML`, so model text cannot inject markup. Partial input (mid-stream) renders as far as it parses.

## Cards

Card payloads are `JsonValue` in the contract. The recipe card's Save posts the draft's own `ops` (R-53) with `POST /change-sets`. `components/chat/cards/parse.ts` validates each card with a Zod schema per `CARD_TYPES` entry (types imported from `@mealplanner/ai/agent` with `import type` only, so no SDK code reaches the browser bundle); an unknown or malformed card renders a small "This card can't be shown" note with its type, never a crash. Each card type has its own component (AGT-7 list plus `iteration_limit`).

## Voice input

The Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), feature-detected; the mic button is absent where it is unavailable. Nothing is sent without the admin pressing Send.

## Libraries

None added. `motion` (already a dependency, UX-5) for the Accept "stamp" and card rise, behind `prefers-reduced-motion`. Primitives from `components/ui` (1.4.2); the fetch client, problem messages and `useLoad` from `components/admin` (1.4.6, imported, not copied).
