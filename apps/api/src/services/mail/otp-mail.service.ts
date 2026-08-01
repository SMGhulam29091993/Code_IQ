import type { IMailService } from "./mail.types";
import { mailTransporter } from "./mailer";
import { env } from "../../lib/env";

export class OtpMailService implements IMailService {
  async send(to: string, data: { otp: string }): Promise<void> {
    await mailTransporter.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: "Your CodeIQ verification code",
      text: `Your verification code is ${data.otp}. It expires in 5 minutes.`,
    });
  }
}
