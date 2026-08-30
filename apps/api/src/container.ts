// DI wiring — see .ai/rules/architecture-rules.md "Dependency flow".
// Nothing outside this file calls `new SomeService(...)`. Each module's controller
// is instantiated here with its concrete service/repository and imported by
// src/routes/index.ts. Populated starting with the auth module (.ai/plans/backend.md Step 2).
import { ReviewJobProcessor } from "./jobs/review.job";
import { geminiModel } from "./lib/gemini";
import { stripeClient } from "./lib/stripe";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { OtpRepository } from "./modules/auth/otp.repository";
import { RefreshTokenRepository } from "./modules/auth/refresh-token.repository";
import { UserRepository } from "./modules/auth/user.repository";
import { BillingController } from "./modules/billing/billing.controller";
import { BillingService } from "./modules/billing/billing.service";
import { ProcessedEventRepository } from "./modules/billing/processed-event.repository";
import { GithubApiClient } from "./modules/github/github-api.client";
import { GithubController } from "./modules/github/github.controller";
import { GithubService } from "./modules/github/github.service";
import { InstallationRepository } from "./modules/github/installation.repository";
import { RepoLookupRepository } from "./modules/github/repo.repository";
import { WebhookController } from "./modules/github/webhook.controller";
import { WebhookService } from "./modules/github/webhook.service";
import { ConfigService } from "./modules/repos/config.service";
import { RepoConfigRepository } from "./modules/repos/repo-config.repository";
import { RepoController } from "./modules/repos/repo.controller";
import { RepoRepository } from "./modules/repos/repo.repository";
import { RepoService } from "./modules/repos/repo.service";
import { CommentService } from "./modules/reviews/comment.service";
import { DiffService } from "./modules/reviews/diff.service";
import { GeminiService } from "./modules/reviews/gemini.service";
import { ReviewChunkRepository } from "./modules/reviews/review-chunk.repository";
import { ReviewIssueRepository } from "./modules/reviews/review-issue.repository";
import { ReviewController } from "./modules/reviews/review.controller";
import { ReviewRepository } from "./modules/reviews/review.repository";
import { ReviewService } from "./modules/reviews/review.service";
import { MailServiceFactory } from "./services/mail/mail-service.factory";
import { OtpService } from "./services/otp.service";

const userRepository = new UserRepository();
const refreshTokenRepository = new RefreshTokenRepository();
const otpRepository = new OtpRepository();
const otpService = new OtpService(otpRepository);
const mailServiceFactory = new MailServiceFactory();

const authService = new AuthService(
  userRepository,
  refreshTokenRepository,
  otpRepository,
  otpService,
  mailServiceFactory
);

export const authController = new AuthController(authService);

const installationRepository = new InstallationRepository();
const repoLookupRepository = new RepoLookupRepository();
const githubApiClient = new GithubApiClient();

const githubService = new GithubService(
  installationRepository,
  repoLookupRepository,
  userRepository,
  githubApiClient
);
const webhookService = new WebhookService(installationRepository, repoLookupRepository);

export const githubController = new GithubController(githubService);
export const webhookController = new WebhookController(webhookService);

const repoRepository = new RepoRepository();
const repoConfigRepository = new RepoConfigRepository();
const configService = new ConfigService(repoConfigRepository);
const reviewRepository = new ReviewRepository();

const repoService = new RepoService(
  repoRepository,
  repoConfigRepository,
  installationRepository,
  reviewRepository
);

export const repoController = new RepoController(repoService);

const processedEventRepository = new ProcessedEventRepository();
const billingService = new BillingService(
  installationRepository,
  userRepository,
  processedEventRepository,
  repoService,
  stripeClient,
  githubApiClient,
  reviewRepository
);

export const billingController = new BillingController(billingService);

const reviewIssueRepository = new ReviewIssueRepository();
const reviewChunkRepository = new ReviewChunkRepository();
const diffService = new DiffService();
const geminiService = new GeminiService(geminiModel);
const commentService = new CommentService();

const reviewService = new ReviewService(reviewRepository, repoRepository);

export const reviewController = new ReviewController(reviewService);

// Consumed by src/jobs/worker.ts's startReviewWorker — not a controller-facing dependency, so
// it isn't exported as a *Controller like the others (.ai/rules/backend.md #5: only the worker
// calls into the review pipeline for async jobs).
export const reviewJobProcessor = new ReviewJobProcessor(
  reviewRepository,
  reviewIssueRepository,
  installationRepository,
  configService,
  diffService,
  geminiService,
  commentService,
  reviewChunkRepository
);
