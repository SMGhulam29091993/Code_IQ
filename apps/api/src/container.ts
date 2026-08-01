// DI wiring — see .ai/rules/architecture-rules.md "Dependency flow".
// Nothing outside this file calls `new SomeService(...)`. Each module's controller
// is instantiated here with its concrete service/repository and imported by
// src/routes/index.ts. Populated starting with the auth module (.ai/plans/backend.md Step 2).
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { OtpRepository } from "./modules/auth/otp.repository";
import { RefreshTokenRepository } from "./modules/auth/refresh-token.repository";
import { UserRepository } from "./modules/auth/user.repository";
import { MailServiceFactory } from "./services/mail/mail-service.factory";
import { OtpService } from "./services/otp.service";

const userRepository = new UserRepository();
const refreshTokenRepository = new RefreshTokenRepository();
const otpRepository = new OtpRepository();
const otpService = new OtpService(otpRepository);
const mailServiceFactory = new MailServiceFactory();

const authService = new AuthService(
  userRepository,
  refreshTokenRepository,
  otpRepository,
  otpService,
  mailServiceFactory
);

export const authController = new AuthController(authService);
