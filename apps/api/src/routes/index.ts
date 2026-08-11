import { Router } from "express";
import { authRoutes } from "../modules/auth/auth.routes";
import { githubRoutes } from "../modules/github/github.routes";
import { webhookRoutes } from "../modules/github/webhook.routes";
import { repoRoutes } from "../modules/repos/repo.routes";

// Each module mounts itself here as it's built — see .ai/plans/backend.md.
export const router = Router();

router.use("/auth", authRoutes);
router.use("/github", githubRoutes);
router.use("/webhooks", webhookRoutes);
router.use("/repos", repoRoutes);
