// Caps how many `fn` calls run at once, draining `items` through a fixed-size pool of workers
// instead of firing all of them in parallel. Added after the review pipeline's unbounded
// `Promise.allSettled(chunks.map(...))` blew straight through Gemini's free-tier
// requests-per-minute quota on any PR with more than a handful of chunks — see
// .ai/knowledge/domains/review.md "Implementation notes" and jobs/review.job.ts.
//
// Returns settled results in the same shape and original order as `Promise.allSettled`, so it's
// a drop-in replacement at call sites.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        const value = await fn(items[i] as T, i);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
