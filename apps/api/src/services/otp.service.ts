import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { redis } from "../lib/redis";
import type { IOtpRepository } from "../modules/auth/auth.types";

// Exact flow from .ai/knowledge/domains/auth.md "OtpService.create(userId) flow".
const OTP_TTL_SECONDS = 5 * 60;
const OTP_LENGTH = 6;

export interface IOtpService {
  create(userId: string): Promise<{ identifier: string; otp: string }>;
}

export class OtpService implements IOtpService {
  constructor(private readonly otpRepo: IOtpRepository) {}

  async create(userId: string): Promise<{ identifier: string; otp: string }> {
    const identifier = crypto.randomBytes(32).toString("hex");
    const hashedIdentifier = crypto.createHash("sha256").update(identifier).digest("hex");
    const otp = randomDigits(OTP_LENGTH);
    const hashedOtp = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

    // Upsert replaces any prior OTP for this user — one active OTP per user.
    await this.otpRepo.upsertForUser(userId, { hashedIdentifier, hashedOtp, expiresAt });

    // 3-attempt retry limit lives here in Redis (expires alongside the OTP) rather than
    // on the otps row — see the "Open questions" note in knowledge/domains/auth.md.
    await redis.set(
      `otp:${identifier}`,
      JSON.stringify({ hashedIdentifier, attempts: 0 }),
      "EX",
      OTP_TTL_SECONDS
    );

    // otp goes to the mail service only — never returned over HTTP.
    return { identifier, otp };
  }
}

function randomDigits(length: number): string {
  const max = 10 ** length;
  return crypto.randomInt(0, max).toString().padStart(length, "0");
}
