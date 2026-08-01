import nodemailer from "nodemailer";
import { env } from "../../lib/env";

// Same singleton pattern as src/lib/prisma.ts / src/lib/redis.ts — see
// .ai/rules/architecture-rules.md "Infrastructure singleton pattern".
const globalForMailer = globalThis as unknown as { mailTransporter?: nodemailer.Transporter };

export const mailTransporter =
  globalForMailer.mailTransporter ??
  nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD },
  });

if (env.NODE_ENV !== "production") globalForMailer.mailTransporter = mailTransporter;
