import type { Octokit } from "@octokit/rest";

const PAGE_SIZE = 100;
// GitHub's own ceiling for this endpoint ("list pull request files" returns at most 3000 files),
// i.e. 30 pages of 100. The loop also stops on any short page, so this only guards against a
// misbehaving response never returning one.
const MAX_PAGES = 30;

export type PullRequestFile = Awaited<ReturnType<Octokit["pulls"]["listFiles"]>>["data"][number];

/**
 * Every file in a pull request — all pages of `pulls.listFiles`, not just the first.
 *
 * Without `per_page`/`page`, GitHub returns only the first 30 files: before 2026-10-08 the
 * coordinator (review-coordinator.job.ts) called it that way, so a PR touching more than 30 files
 * had every file after the 30th silently left unreviewed. Shared with comment.service.ts, which
 * needs every file's patch to know which lines accept an inline comment.
 *
 * Manual page loop rather than octokit.paginate: the pinned CJS Octokit v19
 * (memory/pitfalls.md #007) pulls in two @octokit/types versions whose RequestInterface types
 * don't unify, so paginate(pulls.listFiles) doesn't typecheck.
 */
export async function listAllPullRequestFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequestFile[]> {
  const all: PullRequestFile[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: PAGE_SIZE,
      page,
    });
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}
