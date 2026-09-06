import { describe, expect, it, vi } from "vitest";
import { mapWithConcurrency } from "../lib/concurrency";

describe("mapWithConcurrency", () => {
  it("resolves all items and preserves original order", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);

    expect(results).toEqual([
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
      { status: "fulfilled", value: 40 },
    ]);
  });

  it("never runs more than `concurrency` calls at once", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("mixes fulfilled and rejected results in PromiseSettledResult shape", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(Error) });
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("caps effective concurrency at the item count when concurrency exceeds it", async () => {
    const fn = vi.fn(async (n: number) => n);

    const results = await mapWithConcurrency([1, 2], 10, fn);

    expect(results).toHaveLength(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns an empty array for an empty input", async () => {
    const results = await mapWithConcurrency<number, number>([], 3, async (n) => n);

    expect(results).toEqual([]);
  });

  it("treats concurrency < 1 as concurrency 1 rather than deadlocking", async () => {
    const results = await mapWithConcurrency([1, 2], 0, async (n) => n);

    expect(results).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 2 },
    ]);
  });
});
