import type { Request, Response } from "express";
import type { IRepoService, ListReposFilters, UpdateConfigInput } from "./repo.types";
import { ok } from "../../lib/response";

// Thin HTTP handlers only — all business logic lives in RepoService.
export class RepoController {
  constructor(private readonly repoService: IRepoService) {}

  listRepos = async (req: Request, res: Response) => {
    const result = await this.repoService.listRepos(
      req.user!.id,
      req.query as unknown as ListReposFilters
    );
    res.status(200).json(ok(result));
  };

  activateRepo = async (req: Request, res: Response) => {
    const result = await this.repoService.activateRepo(req.user!.id, req.params.repoId as string);
    res.status(200).json(ok(result));
  };

  deactivateRepo = async (req: Request, res: Response) => {
    const result = await this.repoService.deactivateRepo(
      req.user!.id,
      req.params.repoId as string
    );
    res.status(200).json(ok(result));
  };

  getConfig = async (req: Request, res: Response) => {
    const result = await this.repoService.getConfig(req.user!.id, req.params.repoId as string);
    res.status(200).json(ok(result));
  };

  updateConfig = async (req: Request, res: Response) => {
    const result = await this.repoService.updateConfig(
      req.user!.id,
      req.params.repoId as string,
      req.body as UpdateConfigInput
    );
    res.status(200).json(ok(result));
  };

  getStats = async (req: Request, res: Response) => {
    const result = await this.repoService.getStats(req.user!.id, req.params.repoId as string);
    res.status(200).json(ok(result));
  };
}
