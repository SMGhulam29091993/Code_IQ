import type { Otp, User } from "@codeiq/db";

// Sanitized user shape returned over HTTP — never includes passwordHash.
// Mirrors @codeiq/types User.
export interface SanitizedUser {
  id: string;
  email: string;
  name: string;
  githubId: string | null;
  githubLogin: string | null;
  createdAt: Date;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface RegisterResult {
  identifier: string;
  user: SanitizedUser;
}

export interface VerifyOtpInput {
  identifier: string;
  otp: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokensResult {
  token: string;
  refreshToken: string;
  user: SanitizedUser;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface RefreshResult {
  token: string;
}

export interface LogoutInput {
  refreshToken: string;
}

// New 2026-08-23 — .ai/knowledge/domains/auth.md "GET/PATCH /auth/me", "POST /auth/change-password".
export interface GetMeResult {
  user: SanitizedUser;
}

export interface UpdateProfileInput {
  name: string;
}

export interface UpdateProfileResult {
  user: SanitizedUser;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: { email: string; name: string; passwordHash: string }): Promise<User>;
  updateLastLogin(id: string): Promise<void>;
  lockEmail(id: string): Promise<void>;
  // GitHub identity linking — .ai/knowledge/domains/auth.md#github-oauth-callback. Never a
  // login bypass; only ever called after a user is already authenticated via JWT.
  findByGithubId(githubId: string): Promise<User | null>;
  linkGithubIdentity(
    userId: string,
    data: { githubId: string; githubLogin: string; githubAccessToken: string }
  ): Promise<User>;
  // Generic profile update — name (PATCH /auth/me) and passwordHash (change-password) are the
  // only two fields ever passed here; email is deliberately not updatable this way, see
  // PATCH /auth/me's doc note.
  update(id: string, data: Partial<{ name: string; passwordHash: string }>): Promise<User>;
}

export interface IRefreshTokenRepository {
  create(data: { userId: string; token: string; expiresAt: Date }): Promise<void>;
  // Redis-backed (refresh-token.repository.ts) — no synthetic row id, just the owning userId
  // logout()'s ownership check needs.
  findByToken(token: string): Promise<{ userId: string } | null>;
  deleteByToken(token: string): Promise<void>;
}

export interface IOtpRepository {
  // One active OTP per user — upsert replaces any prior row for that userId.
  upsertForUser(
    userId: string,
    data: { hashedIdentifier: string; hashedOtp: string; expiresAt: Date }
  ): Promise<Otp>;
  findByHashedIdentifier(hashedIdentifier: string): Promise<Otp | null>;
  deleteById(id: string): Promise<void>;
}

export interface IAuthService {
  register(input: RegisterInput): Promise<RegisterResult>;
  verifyOtp(input: VerifyOtpInput): Promise<AuthTokensResult>;
  login(input: LoginInput): Promise<AuthTokensResult>;
  refresh(input: RefreshInput): Promise<RefreshResult>;
  logout(userId: string, input: LogoutInput): Promise<void>;
  getMe(userId: string): Promise<GetMeResult>;
  updateProfile(userId: string, input: UpdateProfileInput): Promise<UpdateProfileResult>;
  changePassword(userId: string, input: ChangePasswordInput): Promise<void>;
}
