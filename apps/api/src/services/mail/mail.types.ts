// ADR 004: MailServiceFactory.create(type) — see .ai/decisions/004-nodemailer-factory-pattern-for-mail-service.md
export type MailType = "otp" | "welcome";

export interface IMailService {
  send(to: string, data: Record<string, unknown>): Promise<void>;
}

export interface IMailServiceFactory {
  create(type: MailType): IMailService;
}
