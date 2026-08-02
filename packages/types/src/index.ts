// Shared between apps/api and apps/web. Backend responses and frontend consumers
// both type against these — see .ai/rules/frontend.md #1 and .ai/rules/coding-standards.md.

export interface ApiResponse<T = null> {
  success: boolean;
  message: string;
  data: T | null;
}

// Sanitized user shape returned by the API — never includes passwordHash.
export interface User {
  id: string;
  email: string;
  name: string;
  githubId: string | null;
  githubLogin: string | null;
  createdAt: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
}

// GitHub App installation summary — matches
// apps/api/src/modules/github/github.types.ts SanitizedInstallation.
export interface Installation {
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
  planTier: string;
  repoCount: number;
}
