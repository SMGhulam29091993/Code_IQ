import type { IMailService, IMailServiceFactory, MailType } from "./mail.types";
import { OtpMailService } from "./otp-mail.service";
import { WelcomeMailService } from "./welcome-mail.service";

// ADR 004: callers depend only on mailServiceFactory.create(type).send(to, data) and never
// construct a transporter or pick a template themselves.
export class MailServiceFactory implements IMailServiceFactory {
  private readonly services: Record<MailType, IMailService> = {
    otp: new OtpMailService(),
    welcome: new WelcomeMailService(),
  };

  create(type: MailType): IMailService {
    return this.services[type];
  }
}
