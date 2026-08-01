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

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  create(data: { email: string; name: string; passwordHash: string }): Promise<User>;
  updateLastLogin(id: string): Promise<void>;
  lockEmail(id: string): Promise<void>;
}

export interface IRefreshTokenRepository {
  create(data: { userId: string; token: string; expiresAt: Date }): Promise<void>;
  findByToken(token: string): Promise<{ id: string; userId: string } | null>;
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
}
