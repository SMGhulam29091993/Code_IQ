// DI wiring — see .ai/rules/architecture-rules.md "Dependency flow".
// Nothing outside this file calls `new SomeService(...)`. Each module's controller
// is instantiated here with its concrete service/repository and imported by
// src/routes/index.ts. Populated starting with the auth module (.ai/plans/backend.md Step 2).
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { OtpRepository } from "./modules/auth/otp.repository";
import { RefreshTokenRepository } from "./modules/auth/refresh-token.repository";
import { UserRepository } from "./modules/auth/user.repository";
import { GithubApiClient } from "./modules/github/github-api.client";
import { GithubController } from "./modules/github/github.controller";
import { GithubService } from "./modules/github/github.service";
import { InstallationRepository } from "./modules/github/installation.repository";
import { RepoLookupRepository } from "./modules/github/repo.repository";
import { WebhookController } from "./modules/github/webhook.controller";
import { WebhookService } from "./modules/github/webhook.service";
import { RepoConfigRepository } from "./modules/repos/repo-config.repository";
import { RepoController } from "./modules/repos/repo.controller";
import { RepoRepository } from "./modules/repos/repo.repository";
import { RepoService } from "./modules/repos/repo.service";
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
const repoService = new RepoService(repoRepository, repoConfigRepository, installationRepository);

export const repoController = new RepoController(repoService);
