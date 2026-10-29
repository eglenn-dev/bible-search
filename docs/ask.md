# Ask mode

Ask answers one gospel question with a short answer whose claims cite the passages they came from. It's a fourth tab in the app layout (phones, and the installed app at any size). A desktop browser tab starts in the classic layout, which has no Ask; its "Try Ask in the new app" button or Settings › Layout switches to the app layout, and the browser remembers that. It is a single question and answer, not a chat: each question starts fresh.

## How it works

```
app (Ask tab) ──POST /ask──► FastAPI ──► Claude Haiku 5.5 ◄─┐
     ▲                          │          │ search_passages  │ search_result blocks
     └──── server-sent events ──┘          ▼                  │
                                     db.vector_search ────────┘
```

1. `POST /ask` with `{"question": "..."}`. The route checks the Origin, the question length, the per-IP quotas and the day's budget before any model call; a refusal is an ordinary JSON error (`400`, `403`, `429` with `Retry-After`, or `503`). Refusals from a limit also carry a `code` (`budget`, `daily_limit`, `hourly_limit`, `unavailable`) and a `reset_at` timestamp; see [When Ask is closed](#when-ask-is-closed).
2. `api/ask.py` gives Claude Haiku 5.5 one tool, `search_passages` (query, plus optional `sources`, `speaker`, `year_from`, `year_to`), backed by the same `db.vector_search` as `/search`. The model may search up to `ASK_MAX_SEARCHES` times (default 4), several at once if it likes.
3. Each search's passages go back as `search_result` blocks with citations enabled, so the API itself attaches `search_result_location` citations to the answer text. The model never writes citation markers, and a citation can only point at a passage the search returned.
4. The answer streams back as server-sent events:

| Event | Data | Meaning |
|---|---|---|
| `meta` | `{hour_left, day_left}` | Quota left after this question (first event) |
| `search` | `{query}` | The model ran a search |
| `block` | `{}` | A new run of answer text starts |
| `cite` | `{n, passage?}` | The current run cites source `n`; `passage` (same shape as a `/search` result) comes the first time `n` appears |
| `text` | `{text}` | Answer text for the current run |
| `reset` | `{}` | Drop the text and citations so far (the model wrote a draft before searching again); numbering restarts at 1 and each passage is sent again with its first citation |
| `done` / `error` | `{}` / `{message}` | Last event. An answer cut off at `max_tokens` ends in `error`, not `done`, so the app says it was cut off |

The client (`client/src/lib/ask.ts`, `client/src/components/mobile/ask-tab.tsx`) renders each run of text followed by its citation numbers. Tapping a number, or a card under **Sources**, opens the passage in the same sheet (or split-view pane) as a search result, with Save, Share, context and "More like this".

`/ask` is a POST, so the service worker never caches it. It is excluded from the OpenAPI spec (`include_in_schema=False`), so it isn't in `/docs` and isn't an MCP tool: agents bring their own model, and every answer here is paid for.

## Cost

Model settings: `claude-haiku-5-5`, adaptive thinking at effort `low` (`ASK_EFFORT`), automatic prompt caching so each step of the loop re-reads the conversation at a tenth of the input price. A typical question is 2 or 3 model calls and about $0.001 to $0.002.

Haiku 5.5 bills a request at 5x once its prompt (input + cache reads + cache writes) passes 100K tokens. An Ask conversation is around 10K to 20K tokens: at most 4 searches × 6 passages, each passage capped at 1,800 characters. As a backstop, the loop stops if a prompt ever passes 90K tokens. Every call's cost is computed from its `usage` and logged. A call cut off before it finishes (the user closed the app mid-answer, or the model errored) is still billed for what it generated, which the stream never reports, so it counts as its prompt plus a full `max_tokens` of output.

## Abuse and spend controls

| Control | Default | Env var |
|---|---|---|
| Questions per IP per hour | 10 | `ASK_HOURLY_LIMIT` |
| Questions per IP per UTC day | 30 | `ASK_DAILY_LIMIT` |
| Global spend per UTC day; Ask returns 503 once it can't cover another question | $3.00 | `ASK_DAILY_BUDGET_USD` |
| Answers in flight per process; extra requests get 503 | 4 | `ASK_MAX_CONCURRENT` |
| Searches per question | 4 | `ASK_MAX_SEARCHES` |
| Question length | 3 to 500 characters | |
| Origin must be an allowed origin (`ALLOWED_ORIGINS`, `*.vercel.app`) | | |
| Off-topic questions are declined by the system prompt without searching | | |
| Kill switch | on | `ASK_ENABLED=0` |

The quota counters and the daily spend live in MongoDB (`ask_usage`, `MONGODB_ASK_USAGE_COLLECTION`), so a restart or a Render spin-down doesn't reset them; a TTL index removes old counters. A question counts against the quota when it starts, and is handed back if Ask fails on its side: the model can't be reached before its first call, the library search fails, or an unexpected error.

**How the budget stays a hard cap.** Before a question starts, it atomically holds its worst case against the day's spend: every model call it may make (`ASK_MAX_SEARCHES` + 2) at a prompt at the 90K ceiling, all written to the cache, plus a full `max_tokens` of output, which is about $0.09. The hold only goes through if it fits under the budget, so concurrent questions, and questions on other workers, can't overshoot it together. When the question ends, however it ends (answered, failed, or the user left mid-answer), the hold is swapped for what it really cost. If that last write fails or the process dies, the hold stays counted, so errors close Ask early rather than late. As a result Ask closes for the day when less than about $0.09 of the budget is left, and an `ASK_DAILY_BUDGET_USD` below that turns it off. The REST API's general per-IP limit (`RATE_LIMIT`) applies too.

The daily budget is the hard backstop: if quotas are dodged (many IPs, or a forged IP header), the most that can be spent is one day's budget. Also set a monthly spend limit on the Anthropic workspace whose key the API uses.

### When Ask is closed

`GET /ask/status` (also left out of the spec) tells the app whether this caller can ask right now, without using a question:

```jsonc
{"available": true, "hour_left": 7, "day_left": 22}
// or, once a limit is hit:
{"available": false, "hour_left": 7, "day_left": 22, "code": "budget",
 "detail": "Ask has answered as many questions as it can today. Search still works.",
 "reset_at": "2026-10-29T00:00:00+00:00"}
```

The app checks it each time the Ask tab opens. While a limit is in force, it disables the question box and example questions and shows a neutral note with the reset time in the user's own time zone ("back tomorrow at 6:00 PM": the UTC-midnight reset is evening in the US). The note includes a **Search instead** button. When `reset_at` passes, the box reopens on its own. If a question is refused anyway (a limit hit since the tab opened), the app shows the same note and puts the question back in the box for later.

### Client IP

Quotas are per IP, so the API reads the caller's address from a header the edge sets: `CLIENT_IP_HEADERS`, tried in order; the first that holds a valid IP wins, otherwise the socket peer (local dev). The default is `cf-connecting-ip`, which Cloudflare (Render's edge) sets on every request it forwards, replacing whatever the client sent. `True-Client-IP` isn't trusted: Cloudflare only sets it when the zone turns it on, and otherwise passes a client's own value through. `X-Forwarded-For` isn't either: Render's proxy appends to it rather than replacing it, so its first entry can be forged. List only headers your edge always overwrites. Each Ask log records `ip_source`, the header the IP came from; check it in production (see the PR checklist).

## Logs

Each question is logged to `ask_logs` (`MONGODB_ASK_LOG_COLLECTION`; disable with `LOG_ASKS=0`), much like searches go to `query_logs`:

- `question`: what the user asked.
- `searches`: one entry per tool call, in order. Each has the model's arguments (`query`, and `sources`, `speaker`, `year_from`, `year_to` when set), plus `results`: the `id`, `source`, `reference` and `score` of every passage returned. Searches that couldn't run (an unknown speaker, say) have an empty `results` list and an `error`.
- `cited_ids`: the passages the answer cited, in citation order.
- Run details: `answered`, `stop_reason`, `error`, `model`, `model_calls`, `max_prompt_tokens`, `output_tokens`, `cost_usd`, `duration_ms`.
- Caller details: `ip`, `ip_source`, `user_agent`, `created_at`.

The answer text itself isn't logged.

## Setup

Set `ANTHROPIC_API_KEY` on the API host. Without it, `/ask` returns 503 and the rest of the API is unaffected. Everything else has defaults.

## Prompt and behavior

The system prompt (`SYSTEM_PROMPT` in `api/ask.py`) tells the model to search before answering, to answer only from the returned passages (and to say so when they don't answer the question), to write 120 to 250 words of plain prose that names who taught what, not to speak for the Church, and to decline questions that aren't about the gospel or the Church. Haiku 5.5 has no server-side fallback when its safety classifiers decline a request; Ask reports a `refusal` as an error that suggests rephrasing.
