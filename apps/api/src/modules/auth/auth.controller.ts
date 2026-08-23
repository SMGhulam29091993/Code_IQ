import type { Request, Response } from "express";
import type { IAuthService } from "./auth.types";
import { ok } from "../../lib/response";

// Thin HTTP handlers only — all business logic lives in AuthService.
// Express 5 forwards rejected promises to error.middleware.ts automatically.
export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  register = async (req: Request, res: Response) => {
    const result = await this.authService.register(req.body);
    res.status(201).json(ok(result, "Registered — check your email for a verification code"));
  };

  verifyOtp = async (req: Request, res: Response) => {
    const result = await this.authService.verifyOtp(req.body);
    res.status(200).json(ok(result));
  };

  login = async (req: Request, res: Response) => {
    const result = await this.authService.login(req.body);
    res.status(200).json(ok(result));
  };

  refresh = async (req: Request, res: Response) => {
    const result = await this.authService.refresh(req.body);
    res.status(200).json(ok(result));
  };

  logout = async (req: Request, res: Response) => {
    // req.user is guaranteed set by authMiddleware, which this route mounts before validate().
    await this.authService.logout(req.user!.id, req.body);
    res.status(200).json(ok(null, "Logged out"));
  };

  getMe = async (req: Request, res: Response) => {
    const result = await this.authService.getMe(req.user!.id);
    res.status(200).json(ok(result));
  };

  updateProfile = async (req: Request, res: Response) => {
    const result = await this.authService.updateProfile(req.user!.id, req.body);
    res.status(200).json(ok(result));
  };

  changePassword = async (req: Request, res: Response) => {
    await this.authService.changePassword(req.user!.id, req.body);
    res.status(200).json(ok(null, "Password updated"));
  };
}
