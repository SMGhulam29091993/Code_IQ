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

## Addendum (2026-09-12): diagnosability for the account-level-throttle negative above

`codeiq29091993 Bot`'s own review of this ADR flagged the account-level-throttle negative
consequence above, suggesting monitoring/alerting since "the current fallback logic won't
recover from this specific throttle." Correct, and not something code can fix — the recovery is
external (the $10 credit purchase, still not done as of this addendum). What *is* in scope:
diagnosability. Before this addendum, `FallbackLLMClient` logged one `console.warn` per exhausted
tier (six lines when every tier fails), with nothing marking "this was a full-chain failure, not
an isolated one" — piecing that together meant reading and correlating all six.

**Decision:** `FallbackLLMClient.generateContent` now also logs one `console.error` summary line
when every tier is exhausted — `ALL_TIERS_EXHAUSTED (N/N tiers failed): tier1=reason1,
tier2=reason2, ...` — with a short per-tier reason (`describeError`: HTTP status, `429(daily
quota)` for Gemini's specific case, or `network error` for a status-less failure). Deliberately
scoped to logging only, not a monitoring service/scheduled check/user-facing alert — those were
considered and explicitly declined (user's call) in favor of the smallest change that makes the
already-existing failure mode grep-able (`grep ALL_TIERS_EXHAUSTED`) instead of needing to
reconstruct it from scattered per-tier warnings.

## Addendum (2026-09-12): `ILLMClient.generateContent` no longer returns Gemini's own response shape

`codeiq29091993 Bot`'s own review of this ADR's "Adapter" bullet flagged that
`ILLMClient.generateContent`'s return type, `{ response: { text(): string } }`, is "highly
specific, potentially limiting flexibility for future LLMs with diverse response shapes" and
suggested a richer, more abstract response object.

The specificity was real, and not accidental: that shape was chosen originally so `lib/gemini.ts`
could skip writing an adapter entirely — `geminiModel: ILLMClient = genAI.getGenerativeModel(...)`
type-checked via plain structural typing, because a real `GenerativeModel`'s `generateContent`
already returns something matching `{ response: { text() } }`. That convenience *was* the
coupling the finding correctly identified — the interface was shaped around one provider's SDK,
not designed independently of it.

**Decision:** flattened `ILLMClient.generateContent` to return a plain `Promise<{ text: string }>`.
`lib/gemini.ts` now has a real `GeminiClient` adapter class (translating the SDK's
`result.response.text()` into `{ text: result.response.text() }`), matching `OpenRouterClient`'s
existing pattern — both providers go through an explicit adapter uniformly now, none exempted by
a structural-typing shortcut. `GeminiService` reads `result.text` instead of
`result.response.text()`; no other business logic depends on the shape.

**Explicitly not done:** a generic `LLMResponse<T>` with `.json()`/`.usage()`/similar, as the
finding's suggestion floated. Nothing in this codebase consumes token-usage or non-text response
data today (nothing tracks Gemini's or OpenRouter's usage metadata anywhere, despite both APIs
returning it), so building that out now would be exactly the premature abstraction this
project's own conventions warn against — an interface designed for hypothetical future callers
that don't exist yet. The chosen fix addresses the actual defect (coupling to one provider's SDK
shape) without speculatively growing the interface's surface area. Revisit if/when a real caller
needs usage data or a non-text response.

**Consequences:** every test file constructing a mock `ILLMClient` response
(`gemini.service.test.ts`, `llm-client.test.ts`, `openrouter-client.test.ts`) updated from
`{ response: { text: () => ... } }` to `{ text: ... }`. Verified live against the real provider
chain post-change (`buildLLMClient()` → `RetryingLLMClient` → `FallbackLLMClient` → adapter),
confirming the flat shape round-trips correctly end-to-end, not just under mocks. 368/368 tests,
typecheck, lint, and full build clean.

## Addendum (2026-09-13): fail fast + tell the user, instead of a silent long `RUNNING` spinner

The 2026-09-12 addendum above made full-chain exhaustion *diagnosable* (one grep-able log line).
It didn't make it fast or visible to the dashboard user: every `review-chunk` job still
independently rediscovered the exhaustion and burned its own 3 BullMQ `attempts` retrying a call
that couldn't possibly succeed (none of the underlying free-tier quotas reset inside a backoff
window), and the chunk queue's fleet-wide 5/min limiter (`GEMINI_RPM_BUDGET`, `jobs/worker.ts`)
meant a multi-chunk PR could sit in `RUNNING` for many minutes before `review-finalize.job.ts`
finally saw every chunk had failed. Even then, the dashboard showed only a generic "This review
failed to complete." — no indication it was a quota problem, nothing pointing at upgrading or
waiting. User-reported: it just looks stuck, with no explanation.

**Decision — fail fast, whole review (user's explicit choice over "fail fast per-chunk only"):**

1. `lib/llm-client.ts`'s `FallbackLLMClient` now throws a typed `AllTiersExhaustedError` (carrying
   the same per-tier `failures` list already computed for the log line) instead of rethrowing
   whichever provider error happened to come back last — gives callers a reliable `instanceof`
   check instead of string-matching an arbitrary error.
2. New `lib/llm-exhaustion.ts` (`LlmExhaustionService`), same shape as `lib/fairness.ts`'s
   `FairnessService`: a per-review Redis flag (`review:${reviewId}:llm-exhausted`, 600s TTL — long
   enough to cover that review's remaining queued chunks draining at the 5/min limiter, short
   enough not to matter once the review is long done). Scoped to one review, not global — the
   simplest correct scope, and each concurrently-running review's own first affected chunk still
   pays a one-time discovery cost independently, an acceptable, deliberately small blast radius
   (same "smallest change" precedent as the log line itself).
3. `jobs/review-chunk.job.ts`: on `AllTiersExhaustedError`, marks the chunk failed with a fixed
   marker (`ALL_TIERS_EXHAUSTED_CHUNK_ERROR`), calls `markExhausted`, and throws BullMQ's own
   `UnrecoverableError` instead of the raw error — this attempt is terminal, not retried. Before
   calling Gemini at all, it now also checks `isExhausted(reviewId)` first: if another chunk
   already tripped the breaker, it skips the LLM call entirely and fails the same way. Net effect:
   once any chunk hits full exhaustion, every other chunk for that review still queued/running
   fails on its very next pickup — no LLM call, no retry loop — so the Flow's children settle in
   roughly one chunk-processing interval instead of `3 attempts × 6 tiers` per chunk.
4. New `Review.failureReason String?` column (plain nullable string, matching the existing
   `ReviewIssue.severity`/`category` convention rather than a Prisma enum). `review-finalize.job.ts`
   sets it to `"FREE_TIER_EXHAUSTED"` when every failed chunk carries the exhaustion marker
   (re-querying real `ReviewChunk.error` values, never a transient flag — same philosophy as the
   existing DONE/FAILED gate), `null` for any other all-fail cause.
5. Dashboard (`ReviewDetailContent.tsx`): the FAILED state now branches on `failureReason` —
   `"FREE_TIER_EXHAUSTED"` shows "Your team's free AI review quota has been reached. Upgrade for
   uninterrupted reviews, or wait for the free tier to refresh." plus a `/billing` link (reusing
   `PlanLimitBanner.tsx`'s existing amber-banner pattern), otherwise the original generic message.
   Retry stays available either way. No polling-hook change needed — `useReview`'s
   `refetchInterval` already stops on `FAILED`; the fix is making that transition happen quickly.

**Consequences:** a pathological worst case (every tier exhausted from the very first chunk of a
huge PR) now settles to `FAILED` in roughly one chunk's processing time instead of
`totalChunks × 3 attempts × up to 6 tiers` of wasted retries. Doesn't touch or fix the underlying
account-level OpenRouter throttle (still the $10 credit purchase, external to this codebase) —
purely about not making the user wait through it blind. New migration
(`20260913120000_add_review_failure_reason`) applied by hand against the local dev Postgres
(`ALTER TABLE "Review" ADD COLUMN "failureReason" TEXT;`) rather than via `prisma migrate dev`,
because that command's drift check demanded a full `migrate reset` — the dev DB already had
unrelated drift from `fix/github-review-id-overflow`'s BigInt migration (committed on that branch,
applied to the shared dev DB, not yet merged here). Resolving that drift is out of scope for this
fix. 378/378 API tests (368 + this addendum's 10 new ones across `llm-client.test.ts`,
`llm-exhaustion.test.ts` (new), `review-chunk.job.test.ts`, `review-finalize.job.test.ts`), 97/97
web tests, typecheck and lint clean on both apps.
