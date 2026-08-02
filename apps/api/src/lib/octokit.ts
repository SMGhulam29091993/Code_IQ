import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { env } from "./env";

// Exact shapes from .ai/knowledge/domains/github-app.md "Octokit factory".
function decodedPrivateKey(): string {
  return Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf-8");
}

// App-level client — installation metadata, no repo access.
export const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: env.GITHUB_APP_ID,
    privateKey: decodedPrivateKey(),
  },
});

// Installation-level client — repo/PR access, comment posting. Token refresh (1hr TTL) is
// handled automatically by createAppAuth.
export function getInstallationOctokit(githubInstallationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: decodedPrivateKey(),
      installationId: githubInstallationId,
    },
  });
}
