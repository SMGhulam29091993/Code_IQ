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
