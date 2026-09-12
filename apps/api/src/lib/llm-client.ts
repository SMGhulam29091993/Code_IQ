import { env } from "./env";
import { geminiModel } from "./gemini";
import { OpenRouterClient } from "./openrouter";
import type { ILLMClient } from "../modules/reviews/review.types";

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 15_000;

type GenerateContentRequest = Parameters<ILLMClient["generateContent"]>[0];
type GenerateContentResult = Awaited<ReturnType<ILLMClient["generateContent"]>>;

// Decorator — wraps any ILLMClient with retry-with-backoff, using whichever suggested delay the
// error actually carries (Gemini SDK's own RetryInfo detail, or an OpenRouterClient
// LLMClientError's retryAfterMs from a Retry-After header), falling back to exponential backoff
// otherwise. Moved out of GeminiService (decisions/008, 2026-09-06) so "retry a transient
// failure" is the client's own transport concern, not something the review-pipeline business
// logic needs to know about.
export class RetryingLLMClient implements ILLMClient {
  constructor(
    private readonly inner: ILLMClient,
    private readonly label: string
  ) {}

  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.inner.generateContent(request);
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_RETRIES || !isRetryableError(err)) break;
        const delayMs = getRetryDelayMs(err) ?? exponentialBackoffMs(attempt);
        console.warn(
          `[llm-client] "${this.label}" attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${String(err)}`
        );
        await sleep(delayMs);
      }
    }
    throw lastErr;
  }
}

// Composite / Chain of Responsibility — tries each client in priority order, falling through to
// the next on *any* failure. A failure on one model/provider says nothing about the next one:
// each tier here is typically a different provider with its own separate quota, so a 429 on
// tier 1 has no bearing on tier 2. Exists so exhausting one provider's free-tier quota (the
// failure mode that motivated this file, 2026-09-06 — Gemini's 20-requests/day cap) degrades to
// a different free model instead of failing every review outright. See decisions/008.
export class FallbackLLMClient implements ILLMClient {
  constructor(private readonly tiers: Array<{ client: ILLMClient; label: string }>) {
    if (tiers.length === 0) {
      throw new Error("FallbackLLMClient needs at least one client");
    }
  }

  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
    let lastErr: unknown;
    const failures: string[] = [];
    for (const { client, label } of this.tiers) {
      try {
        return await client.generateContent(request);
      } catch (err) {
        lastErr = err;
        failures.push(`${label}=${describeError(err)}`);
        console.warn(`[llm-client] "${label}" exhausted its retries, falling back: ${String(err)}`);
      }
    }
    // One clear, greppable line when the *entire* chain is exhausted — found worth adding
    // 2026-09-12 (codeiq29091993 Bot's own review of decisions/008): OpenRouter's account-level
    // free-tier throttle takes down every configured model at once, and piecing that together
    // from the per-tier warnings above means reading N log lines instead of one. This doesn't
    // fix the throttle (still needs the $10 credit purchase — decisions/008, state/next.md item
    // 9, external to this codebase) — it just makes the failure mode diagnosable at a glance.
    console.error(
      `[llm-client] ALL_TIERS_EXHAUSTED (${failures.length}/${this.tiers.length} tiers failed): ${failures.join(", ")}`
    );
    throw lastErr;
  }
}

// An adapter that already knows more than a status code can (lib/openrouter.ts's
// LLMClientError — see its own comment for why) gets the final say. Everything else falls back
// to a generic, status-code-only heuristic: no status at all means a network-level failure
// (fetch rejected, DNS, etc.), treated as transient; 429/5xx is *usually* the provider's own way
// of saying "try again shortly"; anything else (400/401/403/404) is a request or config problem
// that retrying the *same* model won't fix — RetryingLLMClient gives up immediately so
// FallbackLLMClient can move to the next tier sooner instead of burning MAX_RETRIES backoff
// delays on a guaranteed-to-fail model.
//
// One deliberate exception to the generic heuristic, found empirically (2026-09-06, live-
// testing this file against the real Gemini API — see decisions/008): a 429 whose quotaId
// contains "PerDay" is a *daily* quota, not a per-minute rate limit. Backing off for the
// suggested delay (Google returns something like "retry in 4s"/"59s", the same shape as a
// per-minute limit) and retrying is pointless — the quota won't actually reset until the next
// calendar day regardless of how long this process waits, so treating it as retryable just adds
// minutes of dead time (3 retries × up to a ~60s suggested delay each) before FallbackLLMClient
// ever reaches OpenRouter.
function isRetryableError(err: unknown): boolean {
  const explicit = (err as { retryable?: boolean } | undefined)?.retryable;
  if (typeof explicit === "boolean") return explicit;

  const status = (err as { status?: number } | undefined)?.status;
  if (status === undefined) return true;
  if (status !== 429 && status < 500) return false;
  if (status === 429 && isDailyQuotaError(err)) return false;
  return true;
}

// A short, human-scannable reason per tier for the ALL_TIERS_EXHAUSTED summary line above —
// deliberately terser than the full error (already logged in full by the per-attempt warnings).
function describeError(err: unknown): string {
  const status = (err as { status?: number } | undefined)?.status;
  if (status === 429 && isDailyQuotaError(err)) return "429(daily quota)";
  if (status !== undefined) return String(status);
  return "network error";
}

function isDailyQuotaError(err: unknown): boolean {
  const details = (err as { errorDetails?: Array<Record<string, unknown>> } | undefined)
    ?.errorDetails;
  return (details ?? []).some((d) => {
    const violations = (d as { violations?: Array<{ quotaId?: string }> }).violations;
    return violations?.some((v) => typeof v.quotaId === "string" && v.quotaId.includes("PerDay"));
  });
}

function getRetryDelayMs(err: unknown): number | null {
  const geminiDetails = (err as { errorDetails?: Array<Record<string, unknown>> } | undefined)
    ?.errorDetails;
  const retryInfo = geminiDetails?.find(
    (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );
  const rawDelay = retryInfo?.retryDelay;
  if (typeof rawDelay === "string") {
    const seconds = Number.parseFloat(rawDelay.replace("s", ""));
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000) + 250; // small buffer
  }

  const retryAfterMs = (err as { retryAfterMs?: number | null } | undefined)?.retryAfterMs;
  return typeof retryAfterMs === "number" ? retryAfterMs : null;
}

function exponentialBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Factory — composes the configured chain: Gemini first (free when its own quota isn't
// exhausted, and its prompts/output are the most validated), then each model listed in
// OPEN_ROUTER_MODELS, in order. Reorder/add/remove OpenRouter models via that env var alone —
// no code change or redeploy of this file needed. See decisions/008 for why Gemini stays in the
// chain rather than being replaced outright, and .env.example for the default model list
// (verify against https://openrouter.ai/models — free-tier offerings rotate).
export function buildLLMClient(): ILLMClient {
  const openRouterModels = env.OPEN_ROUTER_MODELS.split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const tiers: Array<{ client: ILLMClient; label: string }> = [
    { client: new RetryingLLMClient(geminiModel, "gemini-2.5-flash"), label: "gemini-2.5-flash" },
    ...openRouterModels.map((model) => ({
      client: new RetryingLLMClient(new OpenRouterClient(model), `openrouter:${model}`),
      label: `openrouter:${model}`,
    })),
  ];

  return new FallbackLLMClient(tiers);
}

export const llmClient: ILLMClient = buildLLMClient();
