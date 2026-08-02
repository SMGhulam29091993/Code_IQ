import type { Installation } from "@codeiq/db";
import type {
  GithubWebhookBody,
  IInstallationRepository,
  IRepoLookupRepository,
  IWebhookService,
  WebhookEventInput,
} from "./github.types";
import { reviewQueue } from "../../jobs/queue";
import { AppError } from "../../lib/errors";

const PULL_REQUEST_ACTIONS = ["opened", "synchronize", "reopened"];
// FREE tier "50 reviews/mo" limit — .ai/knowledge/domains/billing.md. Review pipeline
// enforcement (Step 5/6) hasn't shipped yet, but the Review table already exists
// (packages/db/prisma/schema.prisma), so this counts real rows rather than guessing.
const FREE_TIER_MONTHLY_REVIEW_LIMIT = 50;

export class WebhookService implements IWebhookService {
  constructor(
    private readonly installationRepo: IInstallationRepository,
    private readonly repoRepo: IRepoLookupRepository
  ) {}

  async handle({ event, deliveryId, body }: WebhookEventInput): Promise<string> {
    if (event === "pull_request") {
      return this.handlePullRequest(deliveryId, body);
    }
    if (event === "installation" && body.action === "deleted" && body.installation) {
      await this.installationRepo.updateActiveByGithubId(body.installation.id, false);
      return "Installation deactivated";
    }
    if (event === "installation_repositories" && body.action === "removed") {
      for (const repo of body.repositories_removed ?? []) {
        await this.repoRepo.deactivateByGithubId(repo.id);
      }
      return "Repos deactivated";
    }
    return "Event ignored";
  }

  private async handlePullRequest(
    deliveryId: string | undefined,
    body: GithubWebhookBody
  ): Promise<string> {
    if (!body.action || !PULL_REQUEST_ACTIONS.includes(body.action)) {
      return "Action ignored";
    }
    if (!body.installation || !body.repository || !body.pull_request) {
      return "Action ignored";
    }

    const installation = await this.installationRepo.findByGithubId(body.installation.id);
    if (!installation?.isActive) {
      return "Installation not active";
    }

    const repo = await this.repoRepo.findByGithubId(body.repository.id);
    if (!repo?.isActive) {
      return "Repo not active";
    }

    const reviewOnDraft = repo.config?.reviewOnDraft ?? false;
    if (body.pull_request.draft && !reviewOnDraft) {
      return "Draft PR skipped";
    }

    if (await this.isOverPlanLimit(installation)) {
      return "Plan limit reached";
    }

    try {
      // Await only the enqueue (fast — pushes to Redis), never the job's own processing.
      // See .ai/rules/backend.md #6.
      await reviewQueue.add(
        "review-pr",
        {
          installationId: installation.id,
          repoId: repo.id,
          prNumber: body.pull_request.number,
          prTitle: body.pull_request.title,
          prAuthor: body.pull_request.user.login,
          headSha: body.pull_request.head.sha,
          repoFullName: body.repository.full_name,
        },
        { jobId: deliveryId } // .ai/memory/pitfalls.md #004 — idempotency on GitHub retry
      );
    } catch {
      throw new AppError("Review queue unavailable", 503);
    }

    return "OK";
  }

  private async isOverPlanLimit(installation: Installation): Promise<boolean> {
    if (installation.planTier !== "FREE") {
      return false;
    }
    const count = await this.repoRepo.countReviewsThisMonth(installation.id);
    return count >= FREE_TIER_MONTHLY_REVIEW_LIMIT;
  }
}
