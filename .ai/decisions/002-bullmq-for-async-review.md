# ADR 002: BullMQ for Async Review Processing

## Context
GitHub expects a webhook 200 response within 10 seconds. Gemini review for a large PR (30+ files) can take 30–90 seconds. Awaiting the review in the webhook handler would cause GitHub to mark delivery as failed and retry, creating duplicate reviews.

## Decision
Use BullMQ (Redis-backed) to enqueue review jobs from the webhook handler and process them in a separate worker.

## Consequences
**Positive:**
- Webhook responds in < 100ms (just enqueue + 200).
- Worker retries failed jobs (max 3, exponential backoff) without re-triggering the webhook.
- `jobId` = `X-GitHub-Delivery` header provides free idempotency — duplicate webhooks enqueue once.
- Queue state is observable (Bull Dashboard can be added).
- Worker concurrency is tunable independently of HTTP server.

**Negative:**
- Redis is a required infrastructure dependency.
- Review status is eventually consistent — dashboard polls until DONE/FAILED.
- Additional failure mode: Redis unreachable = reviews cannot be enqueued.

**Applies to:** backend (apps/api/src/jobs/)
