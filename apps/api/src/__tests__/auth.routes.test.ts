import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";
import { redis } from "../lib/redis";

// Mocked so integration tests exercise real routing/validation/middleware/service wiring
// without a live Postgres, Redis, or SMTP server. vi.mock calls are hoisted above these
// imports by vitest's transform regardless of where they're written in the file.
vi.mock("@codeiq/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    otp: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  UserStatus: { ACTIVE: "ACTIVE", LOCKED: "LOCKED" },
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn().mockResolvedValue(["0", []]),
    mget: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
  })),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue(undefined) }),
  },
}));

// container.ts wires the GitHub module (Step 3) alongside auth, and WebhookService imports
// the real reviewQueue, which would otherwise open a real BullMQ/ioredis connection here —
// unrelated to these auth tests. See webhook.service.test.ts for reviewQueue.add coverage.
vi.mock("../jobs/queue", () => ({
  reviewCoordinatorQueue: { add: vi.fn() },
  reviewFlowProducer: { add: vi.fn() },
  REVIEW_CHUNK_QUEUE_NAME: "review-chunk-queue",
  REVIEW_FINALIZE_QUEUE_NAME: "review-finalize-queue",
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

function mockPrisma() {
  return prisma as unknown as {
    user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    otp: {
      upsert: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
}

function mockRedis() {
  return redis as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    scan: ReturnType<typeof vi.fn>;
    mget: ReturnType<typeof vi.fn>;
  };
}

describe("Auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/auth/register", () => {
    it("returns 201 and an OTP identifier on success", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(null);
      mockPrisma().user.create.mockResolvedValueOnce(buildUser());
      mockPrisma().otp.upsert.mockResolvedValueOnce({});
      mockRedis().set.mockResolvedValueOnce("OK");

      const res = await request(app).post("/api/auth/register").send({
        email: "user@example.com",
        password: "hunter2!!",
        name: "Ada Lovelace",
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.identifier).toBe("string");
      expect(res.body.data.user).toMatchObject({ email: "user@example.com", name: "Ada Lovelace" });
      expect(res.body.data.user).not.toHaveProperty("passwordHash");
      expect(res.body.data).not.toHaveProperty("otp");
    });

    it("returns 400 for an invalid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        email: "not-an-email",
        password: "hunter2!!",
        name: "Ada",
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: "Invalid email format", data: null });
    });

    it("returns 409 when the email is already registered", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());

      const res = await request(app).post("/api/auth/register").send({
        email: "user@example.com",
        password: "hunter2!!",
        name: "Ada",
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe("Email already in use");
    });
  });

  describe("POST /api/auth/verify-otp", () => {
    it("returns 200 with tokens when the OTP is correct", async () => {
      const hashedOtp = await bcrypt.hash("123456", 10);
      mockRedis().get.mockResolvedValueOnce(
        JSON.stringify({ hashedIdentifier: "hashed-id", attempts: 0 })
      );
      mockPrisma().otp.findUnique.mockResolvedValueOnce({
        id: "otp-1",
        userId: "user-1",
        hashedIdentifier: "hashed-id",
        hashedOtp,
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockPrisma().otp.deleteMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ identifier: "opaque-identifier", otp: "123456" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
      expect(res.body.data.user.email).toBe("user@example.com");
    });

    it("returns 400 when the identifier is unknown/expired", async () => {
      mockRedis().get.mockResolvedValueOnce(null);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ identifier: "unknown", otp: "123456" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("OTP expired or invalid, please register again");
    });

    it("returns 401 for a wrong OTP", async () => {
      const hashedOtp = await bcrypt.hash("999999", 10);
      mockRedis().get.mockResolvedValueOnce(
        JSON.stringify({ hashedIdentifier: "hashed-id", attempts: 0 })
      );
      mockPrisma().otp.findUnique.mockResolvedValueOnce({
        id: "otp-1",
        userId: "user-1",
        hashedIdentifier: "hashed-id",
        hashedOtp,
        expiresAt: new Date(Date.now() + 60_000),
      });
      mockRedis().set.mockResolvedValueOnce("OK");

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ identifier: "opaque-identifier", otp: "123456" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid OTP");
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns 200 with tokens for valid credentials", async () => {
      const passwordHash = await bcrypt.hash("hunter2!!", 12);
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser({ passwordHash }));
      mockPrisma().user.update.mockResolvedValueOnce({});

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "user@example.com", password: "hunter2!!" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
    });

    it("returns 401 for invalid credentials", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(null);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "ghost@example.com", password: "hunter2!!" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid email or password");
    });
  });

  describe("POST /api/auth/refresh", () => {
    it("returns 200 with a new access token for a valid refresh token", async () => {
      const refreshToken = jwt.sign({ sub: "user-1" }, process.env.JWT_REFRESH_SECRET!, {
        expiresIn: "7d",
      });
      mockRedis().get.mockResolvedValueOnce("user-1");
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());

      const res = await request(app).post("/api/auth/refresh").send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
    });

    it("returns 401 for an invalid refresh token", async () => {
      const res = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: "not-a-real-jwt" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Invalid refresh token");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns 401 without an Authorization header", async () => {
      const res = await request(app)
        .post("/api/auth/logout")
        .send({ refreshToken: "some-token" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Missing or malformed authorization header");
    });

    it("returns 200 and revokes the refresh token when authenticated", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockRedis().get.mockResolvedValueOnce("user-1");
      mockRedis().del.mockResolvedValueOnce(1);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken: "some-token" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Logged out");
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns 401 without an Authorization header", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 200 with the current user's sanitized profile", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      // authMiddleware and AuthService.getMe both resolve via prisma.user.findUnique.
      mockPrisma().user.findUnique.mockResolvedValue(buildUser());

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user).toMatchObject({ email: "user@example.com", name: "Ada Lovelace" });
      expect(res.body.data.user).not.toHaveProperty("passwordHash");
    });
  });

  describe("PATCH /api/auth/me", () => {
    it("returns 200 with the updated name", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      mockPrisma().user.findUnique.mockResolvedValue(buildUser());
      mockPrisma().user.update.mockResolvedValueOnce(buildUser({ name: "New Name" }));

      const res = await request(app)
        .patch("/api/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe("New Name");
    });

    it("returns 400 for an empty name", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      mockPrisma().user.findUnique.mockResolvedValue(buildUser());

      const res = await request(app)
        .patch("/api/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "   " });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Name is required");
    });
  });

  describe("POST /api/auth/change-password", () => {
    it("returns 200 when current password is correct", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      const passwordHash = await bcrypt.hash("old-password", 4);
      mockPrisma().user.findUnique.mockResolvedValue(buildUser({ passwordHash }));
      mockPrisma().user.update.mockResolvedValueOnce({});

      const res = await request(app)
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: "old-password", newPassword: "new-password-123" });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Password updated");
    });

    it("revokes every refresh token belonging to the user on success", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      const passwordHash = await bcrypt.hash("old-password", 4);
      mockPrisma().user.findUnique.mockResolvedValue(buildUser({ passwordHash }));
      mockPrisma().user.update.mockResolvedValueOnce({});
      mockRedis().scan.mockResolvedValueOnce([
        "0",
        ["refresh_token:mine", "refresh_token:someone-elses"],
      ]);
      mockRedis().mget.mockResolvedValueOnce(["user-1", "user-2"]);

      const res = await request(app)
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: "old-password", newPassword: "new-password-123" });

      expect(res.status).toBe(200);
      expect(mockRedis().del).toHaveBeenCalledWith("refresh_token:mine");
      expect(mockRedis().del).not.toHaveBeenCalledWith("refresh_token:someone-elses");
    });

    it("returns 401 when current password is incorrect", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      const passwordHash = await bcrypt.hash("old-password", 4);
      mockPrisma().user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      const res = await request(app)
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: "wrong", newPassword: "new-password-123" });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Current password is incorrect");
    });

    it("returns 400 for a GitHub-only account with no password", async () => {
      const accessToken = jwt.sign({ sub: "user-1" }, process.env.JWT_SECRET!, {
        expiresIn: "15m",
      });
      mockPrisma().user.findUnique.mockResolvedValue(buildUser({ passwordHash: null }));

      const res = await request(app)
        .post("/api/auth/change-password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ currentPassword: "anything", newPassword: "new-password-123" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "This account signs in with GitHub and has no password to change"
      );
    });
  });
});
