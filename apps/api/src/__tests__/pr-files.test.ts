import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { listAllPullRequestFiles } from "../modules/reviews/pr-files";

function files(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({ filename: `f${offset + i}.ts`, patch: "+x" }));
}

function buildOctokit(pages: Array<ReturnType<typeof files>>) {
  const listFiles = vi.fn();
  for (const page of pages) listFiles.mockResolvedValueOnce({ data: page });
  return { pulls: { listFiles } } as unknown as Octokit;
}

describe("listAllPullRequestFiles", () => {
  it("requests 100 files per page, starting at page 1", async () => {
    const octokit = buildOctokit([files(3)]);

    await listAllPullRequestFiles(octokit, "acme", "widgets", 7);

    expect(octokit.pulls.listFiles).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      pull_number: 7,
      per_page: 100,
      page: 1,
    });
  });

  // 2026-10-08: the coordinator used to call listFiles with no paging and saw only 30 files.
  it("keeps fetching while pages are full, returning every file", async () => {
    const octokit = buildOctokit([files(100), files(100, 100), files(42, 200)]);

    const result = await listAllPullRequestFiles(octokit, "acme", "widgets", 7);

    expect(result).toHaveLength(242);
    expect(octokit.pulls.listFiles).toHaveBeenCalledTimes(3);
    expect(octokit.pulls.listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  });

  it("stops after one request for a small PR", async () => {
    const octokit = buildOctokit([files(5)]);

    expect(await listAllPullRequestFiles(octokit, "acme", "widgets", 7)).toHaveLength(5);
    expect(octokit.pulls.listFiles).toHaveBeenCalledTimes(1);
  });

  it("never asks for more than GitHub's 30-page (3000-file) maximum", async () => {
    const listFiles = vi.fn().mockResolvedValue({ data: files(100) });
    const octokit = { pulls: { listFiles } } as unknown as Octokit;

    const result = await listAllPullRequestFiles(octokit, "acme", "widgets", 7);

    expect(listFiles).toHaveBeenCalledTimes(30);
    expect(result).toHaveLength(3000);
  });
});
