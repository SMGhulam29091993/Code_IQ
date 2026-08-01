import type { IMailService } from "./mail.types";
import { mailTransporter } from "./mailer";
import { env } from "../../lib/env";

export class WelcomeMailService implements IMailService {
  async send(to: string, data: { name: string }): Promise<void> {
    await mailTransporter.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: "Welcome to CodeIQ",
      text: `Hi ${data.name}, welcome to CodeIQ.`,
    });
  }
}
