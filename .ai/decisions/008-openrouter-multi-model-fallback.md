# ADR 008: OpenRouter Multi-Model Fallback for the Review Pipeline

## Context
The review pipeline's only LLM provider was Gemini 2.5 Flash (`lib/gemini.ts`, chosen in
`plans/backend.md` Step 5 after Pro-tier models turned out to require billing). On 2026-09-06,
real usage — several real PRs reviewed across a session, each chunked into one Gemini call per
file plus a summary call — exhausted a quota nobody had noticed before:
`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, value **20 requests per day**. This is
separate from the requests-per-minute quota `lib/concurrency.ts`/`gemini.service.ts`'s existing
retry-with-backoff (added 2026-08-26) already handled — a daily cap doesn't clear by waiting a
few seconds or even a minute, so every review failed outright for the rest of the day. Seven
real `Review` rows show this: all `status: FAILED`, `totalChunks: 0`, every chunk's log line
`[429 Too Many Requests] ... quotaValue: "20"`.

The user added an OpenRouter API key (`OPEN_ROUTER_API_KEY`) and asked for a proper low-level
design supporting multiple LLM models for optimization and scalability, rather than a one-line
provider swap.

## Decision
Keep Gemini as the first tier (it's free when its own quota isn't exhausted, and its prompts are
the most validated) and add OpenRouter's free-tier models as fallback tiers behind it, composed
through three small classes behind the existing `ILLMClient` seam (renamed from `IGeminiClient`
— it stopped being Gemini-specific) so `GeminiService` and the BullMQ job processors need zero
changes:

- **Adapter** — `lib/gemini.ts`'s `geminiModel` (unchanged) and the new `lib/openrouter.ts`'s
  `OpenRouterClient` (one instance per model id) both implement `ILLMClient`, translating their
  own provider's request/response shape into the single `generateContent({ systemInstruction,
  contents }) → { response: { text() } }` shape `GeminiService` calls.
- **Decorator** — `lib/llm-client.ts`'s `RetryingLLMClient` wraps any `ILLMClient` with
  retry-with-backoff, honoring whichever suggested delay the error actually carries (Gemini
  SDK's own `RetryInfo` detail, or an `OpenRouterClient` `LLMClientError`'s `retryAfterMs` from a
  `Retry-After` header) and falling back to exponential backoff otherwise. This is the retry
  logic that used to live inside `GeminiService` itself (`withGeminiRetry`) — moved out because
  it's a transport concern of *the client*, not a business-logic concern of *the review
  pipeline*, and it needed to work the same way regardless of which provider is being retried.
- **Composite / Chain of Responsibility** — `lib/llm-client.ts`'s `FallbackLLMClient` holds an
  ordered list of (already retry-decorated) clients and tries each in turn, falling through to
  the next on *any* failure. A failure on one model says nothing about the next: each tier is
  typically a different provider with its own separate quota.
- **Factory** — `lib/llm-client.ts`'s `buildLLMClient()` composes the configured chain: Gemini
  first, then each model in `OPEN_ROUTER_MODELS` (comma-separated env var, tried left to right).
  `container.ts` wires the resulting singleton (`llmClient`) into `GeminiService`, replacing the
  direct `geminiModel` import.

Retry classification (`isRetryableError`) has two deliberate refinements beyond a naive
"429/5xx = retry" rule, both found by live-testing this file against the real APIs rather than
assumed up front:

1. **A 429 whose Gemini `quotaId` contains `"PerDay"` is not retried.** Backing off for Google's
   suggested delay (it returns something like `"retry in 4s"`, indistinguishable in shape from a
   per-minute limit's suggested delay) and retrying is pointless — the quota won't reset until
   the next calendar day regardless. Treating it as retryable was adding minutes of dead time (3
   retries × up to a ~60s suggested delay each) before `FallbackLLMClient` ever reached
   OpenRouter, observed directly: a smoke-test run timed out at 2 minutes before this fix, and
   completed in seconds after it.
2. **`OpenRouterClient`'s `LLMClientError` carries its own `retryable` flag** (true unless
   401/403) rather than leaving classification to a generic status-code check. OpenRouter's free
   models run on a shared, unreserved capacity pool — live-testing this file showed the *exact
   same* well-formed request against the *exact same* model returning a proper 429 one moment
   and a misleading 400 `"messages.0.content: Invalid input"` the next, purely due to upstream
   pool congestion. A generic classifier would treat that 400 as a permanent client error and
   give up immediately instead of retrying/falling back; since every request this adapter sends
   is built by our own code from a fixed shape, a 400 here is overwhelmingly more likely to be a
   mislabeled capacity blip than an actual malformed request.

## Consequences

**Positive:**
- Exhausting Gemini's daily quota degrades to a different free model instead of failing every
  review outright — the actual failure mode that motivated this ADR.
- Adding, removing, or reordering OpenRouter models is a `.env` change (`OPEN_ROUTER_MODELS`),
  not a code change or redeploy.
- `GeminiService` got *simpler*, not more complex — it lost its own retry loop entirely and now
  just calls `this.llmClient.generateContent(...)` once, trusting the injected client to handle
  transience. The multi-provider complexity lives entirely in `lib/llm-client.ts` and
  `lib/openrouter.ts`, which the business-logic layer never sees.
- The rename `IGeminiClient` → `ILLMClient` makes the interface honest about what it now is.

**Negative:**
- OpenRouter's free-tier models are meaningfully less reliable than Gemini's own quota was
  *when available*: live-testing observed a brand-new, zero-lifetime-spend OpenRouter key
  (`usage: 0` on `GET /api/v1/key`) start returning the same generic 400
  `"messages.0.content: Invalid input"` across *every* configured model simultaneously after
  roughly 30 requests in 15 minutes — consistent with OpenRouter's documented low default
  request ceiling for free-tier accounts that have never purchased credit (their own
  documentation ties a meaningfully higher ceiling to a one-time $10 credit purchase, not
  ongoing spend). This is an account-level throttle, not a per-model one, so it isn't visible to
  `FallbackLLMClient` as "try the next model" — every tier fails together once it triggers. A
  one-time $10 OpenRouter credit purchase is the recommended fix; not done as part of this ADR
  (billing action, needs the user's own decision).
- Six total tiers (Gemini + 5 OpenRouter models) means a review chunk that exhausts every tier
  takes noticeably longer to fail than the old single-provider pipeline did — each tier gets its
  own retry budget (up to 3 attempts) before falling through.
- The default `OPEN_ROUTER_MODELS` list was chosen from a live snapshot of
  `https://openrouter.ai/api/v1/models`'s free tier (2026-09-06) and verified to return real
  parseable JSON under `response_format: json_object` at that moment — free-tier catalogs rotate
  models in and out, so this list will eventually need re-verifying against that endpoint.

**Applies to:** backend (`apps/api/src/lib/gemini.ts`, `apps/api/src/lib/openrouter.ts`,
`apps/api/src/lib/llm-client.ts`, `apps/api/src/modules/reviews/gemini.service.ts`,
`apps/api/src/modules/reviews/review.types.ts`, `apps/api/src/container.ts`)
