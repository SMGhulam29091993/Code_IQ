# ADR 009: Local Ollama Model as the First LLM Tier in Development

## Context
Every review chunk is one LLM call (plus one summary call per review). In local development —
building and re-running the pipeline against real PRs — that burns the same free-tier quotas
production depends on: Gemini 2.5 Flash's 20 requests/day and OpenRouter's account-level
free-tier ceiling (decisions/008). Both have been exhausted by development usage alone, which
left real end-to-end reviews unverifiable for days at a time (`state/next.md` item 13).

The developer now runs Ollama locally with `qwen2.5-coder:7b`.

## Decision
Add an `OllamaClient` adapter (`lib/ollama.ts`) behind the existing `ILLMClient` seam and put it
**first** in `buildLLMClient()`'s fallback chain when `OLLAMA_MODEL` is set:
`ollama:<model>` → `gemini-2.5-flash` → each `OPEN_ROUTER_MODELS` entry. Unset → chain
unchanged. No change to `GeminiService`, the job processors, or the Adapter/Decorator/Composite
structure from decisions/008 — this is one more adapter and one more tier.

- **Dev-only, enforced at boot:** `env.ts` refuses to start with `OLLAMA_MODEL` set under
  `NODE_ENV=production`. A localhost model is never a production dependency.
- **Native `/api/chat`, not the OpenAI-compatible `/v1` endpoint** — only the native one takes
  per-request `options.num_ctx`. Set to 16384 so the system prompt (which carries the JSON
  schema) isn't silently truncated by Ollama's small default context on a 300-line chunk.
  `format: "json"` forces JSON output, same role as Gemini's `responseMimeType`.
- **Retry classification inverted vs. OpenRouter:** connection refused / timeout (120s) / 4xx
  (e.g. model not pulled) are non-retryable, so the chain falls straight through to Gemini
  instead of spending backoff delays on a dead localhost. Only 5xx retries.
- **Docker:** `docker-compose.yml` sets `OLLAMA_BASE_URL=http://host.docker.internal:11434` for
  the `api` container (its own `localhost` isn't the host's Ollama).

## Consequences
**Positive:**
- Local development spends zero Gemini/OpenRouter quota while Ollama is up; the free tiers are
  left for whatever actually needs them.
- Ollama being down degrades to the existing chain automatically, at the cost of one failed
  local connection per call (no retries).
- Verified live 2026-10-04: the real `GeminiService.reviewDiff` prompt against
  `qwen2.5-coder:7b` returned schema-valid JSON (correctly flagged a planted SQL injection as
  critical/security) in ~13s including cold model load.

**Negative:**
- A 7B local model reviews less thoroughly than Gemini 2.5 Flash (the same smoke test missed a
  password-field leak in the same snippet). Dev reviews are for exercising the pipeline, not a
  quality benchmark of the product.
- The chunk queue's fleet-wide limiter (`GEMINI_RPM_BUDGET` = 5/min, `jobs/worker.ts`) still
  applies, even though Ollama has no rate limit. Left as-is: local inference is ~10–30s per chunk
  anyway, and the limiter still protects Gemini whenever Ollama falls through. Revisit if local
  reviews of large PRs feel throttled.
- `AllTiersExhaustedError` / `FREE_TIER_EXHAUSTED` (decisions/008's 2026-09-13 addendum) now
  also needs Ollama to fail before it fires in dev — the user-facing message still reads as a
  quota problem, which is accurate for the tiers after it.

**Applies to:** backend (`apps/api/src/lib/ollama.ts`, `apps/api/src/lib/llm-client.ts`,
`apps/api/src/lib/env.ts`, `apps/api/.env.example`, `apps/api/docker-compose.yml`)

## Addendum (2026-10-04): serialize requests, timeout measures inference only

The first real pipeline run against `qwen2.5-coder:7b` hit
`Ollama ... unreachable: TimeoutError` on many chunks even though Ollama was healthy (`ollama ps`
showed the model loaded on GPU). Cause: the chunk worker runs up to 10 jobs concurrently
(`CHUNK_WORKER_POD_CONCURRENCY`) — doubled that session by two API processes running at once —
while a local Ollama only works through a few requests at a time. Requests waiting in Ollama's
own queue counted against the 120s `AbortSignal.timeout`, so they "timed out" before inference
ever started.

**Decision:** `OllamaClient` serializes its own requests (one in flight per instance — i.e. per
API process, since `llmClient` is a singleton), so the timeout starts only when a request is
actually sent. Default timeout raised to 300s, overridable via `OLLAMA_TIMEOUT_MS`. Timeout and
connection failure now produce distinct messages (`timed out after Nms` vs `unreachable at
<url>`) — the old "unreachable" wording for a timeout pointed at the wrong fix.

**Consequence:** in dev, chunk jobs for a large PR now wait on each other in-process rather than
in Ollama — total wall-clock time is the same (Ollama was the bottleneck either way), but no
chunk fails just for having waited. Running two API processes against one Redis still doubles
the queue consumers; run only one locally.

## Addendum (2026-10-07): cap generated tokens (`num_predict`)

A later live run logged `Ollama ... timed out after 300000ms` and PR #15's finalize sat for
minutes (its summary request queued behind PR #16's chunk calls in the serialized Ollama queue,
then fell back down the chain). Re-measured in isolation with the real data: the PR summary over
all 55 issues took 2.7s (40 output tokens); the largest real chunk (152 lines) took 62.7s (662
output tokens, 9 issues). Generation runs at only ~16 tokens/s on this machine. So the exact
request that hit 300s couldn't be reproduced — most likely an unusually long output on one chunk,
or the Mac slowing under memory pressure mid-run — but nothing bounded a single answer's length.

**Decision:** every Ollama request sets `options.num_predict` (default 2048 — >3x the largest
measured output, ~2 min at 16 tok/s; `OLLAMA_NUM_PREDICT` to override). A response Ollama stops
for length (`done_reason: "length"`) is half-written JSON, so `OllamaClient` throws a
non-retryable `LLMClientError` instead of returning it — otherwise `GeminiService`'s
`JSON.parse` would fail *outside* the LLM client, where `FallbackLLMClient` can't see it, and
the chunk would fail instead of falling through to Gemini. Live-verified: cap 10 → the
cap error; cap 2048 → normal JSON.

**Not done (noted):** the summary request shares the same FIFO queue as chunk calls, so a
review's finalize can wait behind another review's chunks. A priority lane for summary calls is
the follow-up if that wait matters in practice.
