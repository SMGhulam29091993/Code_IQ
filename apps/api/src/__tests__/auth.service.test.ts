import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from "../lib/errors";
import * as jwtLib from "../lib/jwt";
import { redis } from "../lib/redis";
import { AuthService } from "../modules/auth/auth.service";
import type {
  IOtpRepository,
  IRefreshTokenRepository,
  IUserRepository,
} from "../modules/auth/auth.types";
import type { IMailServiceFactory } from "../services/mail/mail.types";
import type { IOtpService } from "../services/otp.service";

vi.mock("../lib/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock("../lib/jwt", () => ({
  signAccessToken: vi.fn(() => "access-token"),
  signRefreshToken: vi.fn(() => "refresh-token"),
  refreshTokenExpiry: vi.fn(() => new Date("2026-01-08T00:00:00Z")),
  verifyRefreshToken: vi.fn(() => ({ sub: "user-1" })),
}));

const NOW = new Date("2026-01-01T00:00:00Z");

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    passwordHash: "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX",
    status: "ACTIVE",
    githubId: null,
    githubLogin: null,
    githubAccessToken: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildOtpRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "otp-1",
    userId: "user-1",
    hashedIdentifier: "hashed-identifier",
    hashedOtp: "hashed-otp",
    expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("AuthService", () => {
  let userRepo: IUserRepository;
  let refreshTokenRepo: IRefreshTokenRepository;
  let otpRepo: IOtpRepository;
  let otpService: IOtpService;
  let mailServiceFactory: IMailServiceFactory;
  let sendMail: ReturnType<typeof vi.fn>;
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);

    userRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateLastLogin: vi.fn(),
      lockEmail: vi.fn(),
      findByGithubId: vi.fn(),
      linkGithubIdentity: vi.fn(),
      update: vi.fn(),
    };
    refreshTokenRepo = {
      create: vi.fn(),
      findByToken: vi.fn(),
      deleteByToken: vi.fn(),
      deleteAllForUser: vi.fn(),
    };
    otpRepo = {
      upsertForUser: vi.fn(),
      findByHashedIdentifier: vi.fn(),
      deleteById: vi.fn(),
    };
    otpService = {
      create: vi.fn().mockResolvedValue({ identifier: "otp-identifier", otp: "123456" }),
    };
    sendMail = vi.fn().mockResolvedValue(undefined);
    mailServiceFactory = {
      create: vi.fn().mockReturnValue({ send: sendMail }),
    };

    authService = new AuthService(userRepo, refreshTokenRepo, otpRepo, otpService, mailServiceFactory);
  });

  describe("register", () => {
    it("creates user with bcrypt-hashed password", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await authService.register({ email: "user@example.com", password: "hunter2!!", name: "Ada" });

      const createArgs = (userRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(createArgs.passwordHash).not.toBe("hunter2!!");
      expect(await bcrypt.compare("hunter2!!", createArgs.passwordHash)).toBe(true);
    });

    it("creates an OTP for the new user instead of issuing tokens", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await authService.register({ email: "user@example.com", password: "hunter2!!", name: "Ada" });

      expect(otpService.create).toHaveBeenCalledWith("user-1");
      expect(jwtLib.signAccessToken).not.toHaveBeenCalled();
      expect(refreshTokenRepo.create).not.toHaveBeenCalled();
    });

    it("returns the OTP identifier in the response, never the raw otp or a token", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      const result = await authService.register({
        email: "user@example.com",
        password: "hunter2!!",
        name: "Ada",
      });

      expect(result.identifier).toBe("otp-identifier");
      expect(result).not.toHaveProperty("otp");
      expect(result).not.toHaveProperty("token");
    });

    it("returns user without passwordHash field", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      const result = await authService.register({
        email: "user@example.com",
        password: "hunter2!!",
        name: "Ada",
      });

      expect(result.user).not.toHaveProperty("passwordHash");
      expect(result.user).toEqual({
        id: "user-1",
        email: "user@example.com",
        name: "Ada Lovelace",
        githubId: null,
        githubLogin: null,
        createdAt: NOW,
      });
    });

    it("throws ConflictError when email already exists", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await expect(
        authService.register({ email: "user@example.com", password: "hunter2!!", name: "Ada" })
      ).rejects.toBeInstanceOf(ConflictError);
      expect(userRepo.create).not.toHaveBeenCalled();
    });

    it("lowercases and trims email before storing", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await authService.register({ email: "  User@Example.com  ", password: "hunter2!!", name: "Ada" });

      expect(userRepo.findByEmail).toHaveBeenCalledWith("user@example.com");
      const createArgs = (userRepo.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(createArgs.email).toBe("user@example.com");
    });

    it("sends the OTP email via mailServiceFactory fire-and-forget (does not await)", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (userRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());
      let resolveMail: () => void = () => {};
      sendMail.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveMail = resolve;
          })
      );

      const result = await authService.register({
        email: "user@example.com",
        password: "hunter2!!",
        name: "Ada",
      });

      // register() already resolved even though sendMail's promise is still pending.
      expect(result.identifier).toBe("otp-identifier");
      expect(mailServiceFactory.create).toHaveBeenCalledWith("otp");
      expect(sendMail).toHaveBeenCalledWith("user@example.com", { otp: "123456" });
      resolveMail();
    });
  });

  describe("verifyOtp", () => {
    it("returns access and refresh tokens on correct OTP", async () => {
      const otpRow = buildOtpRow();
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 0 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());
      const hashedOtp = await bcrypt.hash("123456", 10);
      otpRow.hashedOtp = hashedOtp;

      const result = await authService.verifyOtp({ identifier: "opaque-id", otp: "123456" });

      expect(result.token).toBe("access-token");
      expect(result.refreshToken).toBe("refresh-token");
      expect(result.user.id).toBe("user-1");
    });

    it("deletes the OTP row and Redis entry after successful verification", async () => {
      const otpRow = buildOtpRow({ hashedOtp: await bcrypt.hash("123456", 10) });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 0 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await authService.verifyOtp({ identifier: "opaque-id", otp: "123456" });

      expect(redis.del).toHaveBeenCalledWith("otp:opaque-id");
      expect(otpRepo.deleteById).toHaveBeenCalledWith("otp-1");
    });

    it("throws BadRequestError when identifier is not found in Redis", async () => {
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.verifyOtp({ identifier: "unknown", otp: "123456" })
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("throws BadRequestError when the OTP row has already expired", async () => {
      const otpRow = buildOtpRow({ expiresAt: new Date(NOW.getTime() - 1000) });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 0 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);

      await expect(
        authService.verifyOtp({ identifier: "opaque-id", otp: "123456" })
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("throws UnauthorizedError and increments attempts on wrong OTP", async () => {
      const otpRow = buildOtpRow({ hashedOtp: await bcrypt.hash("999999", 10) });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 0 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);

      await expect(
        authService.verifyOtp({ identifier: "opaque-id", otp: "123456" })
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(redis.set).toHaveBeenCalledWith(
        "otp:opaque-id",
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 1 }),
        "EX",
        expect.any(Number)
      );
      expect(userRepo.lockEmail).not.toHaveBeenCalled();
    });

    it("locks the user email after the 3rd failed attempt", async () => {
      const otpRow = buildOtpRow({ hashedOtp: await bcrypt.hash("999999", 10) });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 2 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);

      await expect(
        authService.verifyOtp({ identifier: "opaque-id", otp: "123456" })
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(userRepo.lockEmail).toHaveBeenCalledWith("user-1");
      expect(redis.del).toHaveBeenCalledWith("otp:opaque-id");
      expect(otpRepo.deleteById).toHaveBeenCalledWith("otp-1");
    });

    it("throws ForbiddenError once the email is locked, even with the correct OTP", async () => {
      const otpRow = buildOtpRow({ hashedOtp: await bcrypt.hash("999999", 10) });
      (redis.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ hashedIdentifier: otpRow.hashedIdentifier, attempts: 2 })
      );
      (otpRepo.findByHashedIdentifier as ReturnType<typeof vi.fn>).mockResolvedValue(otpRow);

      // Even a textually "correct-looking" OTP on the locking attempt is checked against the
      // real hashedOtp — the 3rd wrong guess locks regardless of what string was submitted.
      await expect(
        authService.verifyOtp({ identifier: "opaque-id", otp: "000000" })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("login", () => {
    it("returns tokens for valid credentials", async () => {
      const passwordHash = await bcrypt.hash("hunter2!!", 12);
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash })
      );

      const result = await authService.login({ email: "user@example.com", password: "hunter2!!" });

      expect(result.token).toBe("access-token");
      expect(result.refreshToken).toBe("refresh-token");
    });

    it("throws UnauthorizedError for wrong password", async () => {
      const passwordHash = await bcrypt.hash("hunter2!!", 12);
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash })
      );

      await expect(
        authService.login({ email: "user@example.com", password: "wrong-password" })
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("throws UnauthorizedError for unknown email (same error message as wrong password)", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.login({ email: "ghost@example.com", password: "hunter2!!" })
      ).rejects.toMatchObject({ message: "Invalid email or password" });
    });

    it("calls bcrypt.compare even when user is not found (timing attack prevention)", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const compareSpy = vi.spyOn(bcrypt, "compare");

      await expect(
        authService.login({ email: "ghost@example.com", password: "hunter2!!" })
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(compareSpy).toHaveBeenCalled();
      compareSpy.mockRestore();
    });

    it("updates last_login_at on successful login", async () => {
      const passwordHash = await bcrypt.hash("hunter2!!", 12);
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash })
      );

      await authService.login({ email: "user@example.com", password: "hunter2!!" });

      expect(userRepo.updateLastLogin).toHaveBeenCalledWith("user-1");
    });

    it("creates a new refresh token row on successful login", async () => {
      const passwordHash = await bcrypt.hash("hunter2!!", 12);
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash })
      );

      await authService.login({ email: "user@example.com", password: "hunter2!!" });

      expect(refreshTokenRepo.create).toHaveBeenCalledWith({
        userId: "user-1",
        token: "refresh-token",
        expiresAt: new Date("2026-01-08T00:00:00Z"),
      });
    });

    it("lowercases email before lookup", async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.login({ email: "  User@Example.com  ", password: "hunter2!!" })
      ).rejects.toBeInstanceOf(UnauthorizedError);

      expect(userRepo.findByEmail).toHaveBeenCalledWith("user@example.com");
    });
  });

  describe("refresh", () => {
    it("returns a new access token for a valid refresh token", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user-1",
      });
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      const result = await authService.refresh({ refreshToken: "valid-refresh-token" });

      expect(result.token).toBe("access-token");
    });

    it("throws for invalid JWT signature", async () => {
      (jwtLib.verifyRefreshToken as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new jwt.JsonWebTokenError("invalid signature");
      });

      await expect(
        authService.refresh({ refreshToken: "bad-token" })
      ).rejects.toMatchObject({ message: "Invalid refresh token" });
    });

    it("throws for expired JWT", async () => {
      (jwtLib.verifyRefreshToken as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new jwt.TokenExpiredError("jwt expired", new Date());
      });

      await expect(
        authService.refresh({ refreshToken: "expired-token" })
      ).rejects.toMatchObject({ message: "Refresh token expired" });
    });

    it("throws when token not found in DB (revoked)", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: "revoked-token" })
      ).rejects.toMatchObject({ message: "Refresh token revoked" });
    });

    it("throws when the user linked to the token no longer exists", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user-1",
      });
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        authService.refresh({ refreshToken: "valid-refresh-token" })
      ).rejects.toMatchObject({ message: "User not found" });
    });
  });

  describe("logout", () => {
    it("deletes the refresh token on success", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user-1",
      });

      await authService.logout("user-1", { refreshToken: "some-token" });

      expect(refreshTokenRepo.deleteByToken).toHaveBeenCalledWith("some-token");
    });

    it("does not throw when the token was already deleted (idempotent)", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(authService.logout("user-1", { refreshToken: "gone" })).resolves.toBeUndefined();
      expect(refreshTokenRepo.deleteByToken).toHaveBeenCalledWith("gone");
    });

    it("throws ForbiddenError when the token belongs to a different user", async () => {
      (refreshTokenRepo.findByToken as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "someone-else",
      });

      await expect(
        authService.logout("user-1", { refreshToken: "not-mine" })
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(refreshTokenRepo.deleteByToken).not.toHaveBeenCalled();
    });
  });

  describe("getMe", () => {
    it("returns the current user's sanitized profile", async () => {
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      const result = await authService.getMe("user-1");

      expect(result.user).toEqual({
        id: "user-1",
        email: "user@example.com",
        name: "Ada Lovelace",
        githubId: null,
        githubLogin: null,
        createdAt: NOW,
      });
    });
  });

  describe("updateProfile", () => {
    it("updates the user's name", async () => {
      (userRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ name: "New Name" })
      );

      const result = await authService.updateProfile("user-1", { name: "New Name" });

      expect(userRepo.update).toHaveBeenCalledWith("user-1", { name: "New Name" });
      expect(result.user.name).toBe("New Name");
    });

    it("trims whitespace from the name before storing", async () => {
      (userRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(buildUser());

      await authService.updateProfile("user-1", { name: "  Padded  " });

      expect(userRepo.update).toHaveBeenCalledWith("user-1", { name: "Padded" });
    });
  });

  describe("changePassword", () => {
    it("updates the password hash when current password is correct", async () => {
      const currentHash = await bcrypt.hash("old-password", 4);
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash: currentHash })
      );

      await authService.changePassword("user-1", {
        currentPassword: "old-password",
        newPassword: "new-password-123",
      });

      expect(userRepo.update).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ passwordHash: expect.any(String) })
      );
      const newHash = (userRepo.update as ReturnType<typeof vi.fn>).mock.calls[0]![1].passwordHash;
      expect(await bcrypt.compare("new-password-123", newHash)).toBe(true);
    });

    it("revokes all existing refresh tokens for the user after a successful change", async () => {
      const currentHash = await bcrypt.hash("old-password", 4);
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash: currentHash })
      );

      await authService.changePassword("user-1", {
        currentPassword: "old-password",
        newPassword: "new-password-123",
      });

      expect(refreshTokenRepo.deleteAllForUser).toHaveBeenCalledWith("user-1");
      expect(refreshTokenRepo.deleteAllForUser).toHaveBeenCalledTimes(1);
    });

    it("throws UnauthorizedError when current password is incorrect", async () => {
      const currentHash = await bcrypt.hash("old-password", 4);
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash: currentHash })
      );

      await expect(
        authService.changePassword("user-1", {
          currentPassword: "wrong-password",
          newPassword: "new-password-123",
        })
      ).rejects.toBeInstanceOf(UnauthorizedError);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(refreshTokenRepo.deleteAllForUser).not.toHaveBeenCalled();
    });

    it("throws BadRequestError for a GitHub-only account with no passwordHash", async () => {
      (userRepo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
        buildUser({ passwordHash: null })
      );

      await expect(
        authService.changePassword("user-1", {
          currentPassword: "anything",
          newPassword: "new-password-123",
        })
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(refreshTokenRepo.deleteAllForUser).not.toHaveBeenCalled();
    });
  });
});
