import { Router } from "express";
import { ListReposQuerySchema, UpdateConfigSchema } from "./repo.validator";
import { repoController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate, validateQuery } from "../../middlewares/validate.middleware";

export const repoRoutes = Router();

/**
 * @swagger
 * /repos:
 *   get:
 *     summary: List repos accessible via the current user's installations
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.get("/", authMiddleware, validateQuery(ListReposQuerySchema), repoController.listRepos);

/**
 * @swagger
 * /repos/{repoId}:
 *   get:
 *     summary: Get a single repo
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.get("/:repoId", authMiddleware, repoController.getRepo);

/**
 * @swagger
 * /repos/{repoId}/activate:
 *   post:
 *     summary: Enable AI reviews for a repo
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.post("/:repoId/activate", authMiddleware, repoController.activateRepo);

/**
 * @swagger
 * /repos/{repoId}/deactivate:
 *   post:
 *     summary: Pause AI reviews for a repo
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.post("/:repoId/deactivate", authMiddleware, repoController.deactivateRepo);

/**
 * @swagger
 * /repos/{repoId}/config:
 *   get:
 *     summary: Get the current per-repo review configuration
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.get("/:repoId/config", authMiddleware, repoController.getConfig);

/**
 * @swagger
 * /repos/{repoId}/config:
 *   patch:
 *     summary: Update per-repo review configuration
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.patch(
  "/:repoId/config",
  authMiddleware,
  validate(UpdateConfigSchema),
  repoController.updateConfig
);

/**
 * @swagger
 * /repos/{repoId}/stats:
 *   get:
 *     summary: Per-repo aggregate review stats
 *     tags: [Repos]
 *     security:
 *       - bearerAuth: []
 */
repoRoutes.get("/:repoId/stats", authMiddleware, repoController.getStats);
