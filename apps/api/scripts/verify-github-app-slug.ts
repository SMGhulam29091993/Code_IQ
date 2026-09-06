import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import * as yaml from "js-yaml";

// .ai/knowledge/domains/github-app.md "A real GitHub App is registered" — this app's slug
// drifted out of sync with the real GitHub registration once already (fixed 2026-08-25,
// codeiq29091993 Bot Warning/Logic finding). This script re-verifies that
// apps/api/docker-compose.yml's checked-in NEXT_PUBLIC_GITHUB_APP_SLUG build arg still matches
// GitHub's own record for GITHUB_APP_ID, so drift is caught in CI instead of silently baking a
// broken install link into the next containerized build.
//
// Deliberately standalone rather than importing lib/octokit.ts / lib/env.ts: those pull in the
// full env schema (DATABASE_URL, JWT secrets, Stripe, mail, ...), none of which this check
// needs — it only needs GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (base64-encoded PEM, same
// encoding as apps/api/.env).

// Resolved relative to cwd, not this file's own location: always invoked as
// `pnpm --filter @codeiq/api run verify:github-app-slug` (or an equivalent `-C apps/api`),
// which puts cwd at apps/api regardless of caller — see package.json.
const COMPOSE_PATH = join(process.cwd(), "docker-compose.yml");

interface ComposeFile {
  services?: {
    web?: {
      build?: {
        args?: {
          NEXT_PUBLIC_GITHUB_APP_SLUG?: string;
        };
      };
    };
  };
}

function getConfiguredSlug(): string {
  const raw = readFileSync(COMPOSE_PATH, "utf-8");
  const parsed = yaml.load(raw) as ComposeFile;
  const slug = parsed.services?.web?.build?.args?.NEXT_PUBLIC_GITHUB_APP_SLUG;
  if (!slug) {
    throw new Error(
      `Could not find services.web.build.args.NEXT_PUBLIC_GITHUB_APP_SLUG in ${COMPOSE_PATH}`
    );
  }
  return slug;
}

async function getRegisteredSlug(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKeyB64) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must both be set");
  }

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: Buffer.from(privateKeyB64, "base64").toString("utf-8"),
    },
  });

  const { data } = await octokit.apps.getAuthenticated();
  if (!data?.slug) {
    throw new Error("GET /app returned no slug — is GITHUB_APP_ID correct?");
  }
  return data.slug;
}

async function main() {
  const [configured, registered] = await Promise.all([
    Promise.resolve(getConfiguredSlug()),
    getRegisteredSlug(),
  ]);

  if (configured !== registered) {
    console.error(
      `GitHub App slug drift detected:\n` +
        `  docker-compose.yml has:      "${configured}"\n` +
        `  GitHub's own registration:  "${registered}"\n\n` +
        `Update NEXT_PUBLIC_GITHUB_APP_SLUG in apps/api/docker-compose.yml (and apps/web/.env` +
        ` for local dev) to "${registered}", or confirm GITHUB_APP_ID points at the right app.`
    );
    process.exit(1);
  }

  console.log(`GitHub App slug "${configured}" matches GitHub's registration. OK.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
