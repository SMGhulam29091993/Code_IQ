import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { User } from "@codeiq/db";
import type {
  AuthTokensResult,
  ChangePasswordInput,
  GetMeResult,
  IAuthService,
  IOtpRepository,
  IRefreshTokenRepository,
  IUserRepository,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RefreshResult,
  RegisterInput,
  RegisterResult,
  SanitizedUser,
  UpdateProfileInput,
  UpdateProfileResult,
  VerifyOtpInput,
} from "./auth.types";
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from "../../lib/errors";
import { refreshTokenExpiry, signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { redis } from "../../lib/redis";
import type { IMailServiceFactory } from "../../services/mail/mail.types";
import type { IOtpService } from "../../services/otp.service";

const REGISTER_PASSWORD_BCRYPT_COST = 12;
const OTP_MAX_ATTEMPTS = 3;

// Computed once at module load — bcrypt.compare always runs against a real hash, even when
// the user doesn't exist, so lookup timing can't reveal account existence (see login()).
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("timing-attack-mitigation", REGISTER_PASSWORD_BCRYPT_COST);

export class AuthService implements IAuthService {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
    private readonly otpRepo: IOtpRepository,
    private readonly otpService: IOtpService,
    private readonly mailServiceFactory: IMailServiceFactory
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = input.email.toLowerCase().trim();
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new ConflictError("Email already in use");
    }

    const passwordHash = await bcrypt.hash(input.password, REGISTER_PASSWORD_BCRYPT_COST);
    const user = await this.userRepo.create({ email, name: input.name, passwordHash });
    const { identifier, otp } = await this.otpService.create(user.id);

    // Fire-and-forget: never blocks the response. Errors are logged, not thrown, so a mail
    // outage doesn't roll back the already-committed user row.
    this.mailServiceFactory
      .create("otp")
      .send(user.email, { otp })
      .catch((err: unknown) => {
        console.error("Failed to send OTP email:", err);
      });

    return { identifier, user: sanitize(user) };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<AuthTokensResult> {
    const redisKey = `otp:${input.identifier}`;
    const raw = await redis.get(redisKey);
    if (!raw) {
      throw new BadRequestError("OTP expired or invalid, please register again");
    }

    const { hashedIdentifier, attempts } = JSON.parse(raw) as {
      hashedIdentifier: string;
      attempts: number;
    };
    const otpRow = await this.otpRepo.findByHashedIdentifier(hashedIdentifier);
    if (!otpRow) {
      throw new BadRequestError("OTP expired or invalid, please register again");
    }
    if (otpRow.expiresAt < new Date()) {
      throw new BadRequestError("OTP expired, please register again");
    }

    const match = await bcrypt.compare(input.otp, otpRow.hashedOtp);
    if (!match) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        await this.userRepo.lockEmail(otpRow.userId);
        await redis.del(redisKey);
        await this.otpRepo.deleteById(otpRow.id);
        throw new ForbiddenError("Too many failed attempts, please use a different email");
      }

      const remainingTtl = Math.max(
        1,
        Math.floor((otpRow.expiresAt.getTime() - Date.now()) / 1000)
      );
      await redis.set(
        redisKey,
        JSON.stringify({ hashedIdentifier, attempts: nextAttempts }),
        "EX",
        remainingTtl
      );
      throw new UnauthorizedError("Invalid OTP");
    }

    await redis.del(redisKey);
    await this.otpRepo.deleteById(otpRow.id);

    const user = await this.userRepo.findById(otpRow.userId);
    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    return this.issueTokens(user);
  }

  async login(input: LoginInput): Promise<AuthTokensResult> {
    const email = input.email.toLowerCase().trim();
    const user = await this.userRepo.findByEmail(email);

    // Always run bcrypt.compare, even when the user doesn't exist, to prevent a timing
    // attack from distinguishing "unknown email" from "wrong password".
    const hashToCompare = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const match = await bcrypt.compare(input.password, hashToCompare);
    if (!user || !match) {
      throw new UnauthorizedError("Invalid email or password");
    }

    await this.userRepo.updateLastLogin(user.id);
    return this.issueTokens(user);
  }

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(input.refreshToken);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError("Refresh token expired");
      }
      throw new UnauthorizedError("Invalid refresh token");
    }

    const stored = await this.refreshTokenRepo.findByToken(input.refreshToken);
    if (!stored) {
      throw new UnauthorizedError("Refresh token revoked");
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    return { token: signAccessToken(user.id) };
  }

  async logout(userId: string, input: LogoutInput): Promise<void> {
    const stored = await this.refreshTokenRepo.findByToken(input.refreshToken);
    if (stored && stored.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
    // No-op if already deleted — logout stays idempotent.
    await this.refreshTokenRepo.deleteByToken(input.refreshToken);
  }

  async getMe(userId: string): Promise<GetMeResult> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      // Shouldn't happen — authMiddleware already resolved req.user from this same id.
      throw new UnauthorizedError("User not found");
    }
    return { user: sanitize(user) };
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UpdateProfileResult> {
    const user = await this.userRepo.update(userId, { name: input.name.trim() });
    return { user: sanitize(user) };
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.userRepo.findById(userId);
    if (!user?.passwordHash) {
      throw new BadRequestError(
        "This account signs in with GitHub and has no password to change"
      );
    }
    const match = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!match) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    const newHash = await bcrypt.hash(input.newPassword, REGISTER_PASSWORD_BCRYPT_COST);
    await this.userRepo.update(userId, { passwordHash: newHash });
  }

  private async issueTokens(user: User): Promise<AuthTokensResult> {
    const token = signAccessToken(user.id);
    const refreshToken = signRefreshToken(user.id);
    await this.refreshTokenRepo.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: refreshTokenExpiry(),
    });
    return { token, refreshToken, user: sanitize(user) };
  }
}

function sanitize(user: User): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    githubId: user.githubId,
    githubLogin: user.githubLogin,
    createdAt: user.createdAt,
  };
}
