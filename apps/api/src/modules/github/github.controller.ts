import type { Request, Response } from "express";
import type { IGithubService, OAuthCallbackQuery } from "./github.types";
import { ok } from "../../lib/response";

// Thin HTTP handlers only — all business logic lives in GithubService.
export class GithubController {
  constructor(private readonly githubService: IGithubService) {}

  oauthUrl = async (req: Request, res: Response) => {
    const result = await this.githubService.getOAuthUrl(req.user!.id);
    res.status(200).json(ok(result));
  };

  oauthCallback = async (req: Request, res: Response) => {
    const { redirectUrl } = await this.githubService.handleOAuthCallback(
      req.query as unknown as OAuthCallbackQuery
    );
    res.redirect(302, redirectUrl);
  };

  saveInstallation = async (req: Request, res: Response) => {
    const result = await this.githubService.saveInstallation(req.user!.id, req.body);
    res.status(201).json(ok(result, "Installation saved"));
  };

  listInstallations = async (req: Request, res: Response) => {
    const result = await this.githubService.listInstallations(req.user!.id);
    res.status(200).json(ok(result));
  };

  deleteInstallation = async (req: Request, res: Response) => {
    const installationId = req.params.installationId as string;
    await this.githubService.deleteInstallation(req.user!.id, installationId);
    res.status(200).json(ok(null, "Installation removed"));
  };
}
