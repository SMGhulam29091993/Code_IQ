import { Router } from "express";
import { InstallationSchema, OAuthCallbackQuerySchema } from "./github.validator";
import { githubController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate, validateQuery } from "../../middlewares/validate.middleware";

export const githubRoutes = Router();

/**
 * @swagger
 * /github/oauth/url:
 *   get:
 *     summary: Generate the GitHub OAuth authorization URL for identity linking
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 */
githubRoutes.get("/oauth/url", authMiddleware, githubController.oauthUrl);

/**
 * @swagger
 * /github/oauth/callback:
 *   get:
 *     summary: Exchange OAuth code for a token and link the GitHub identity
 *     tags: [GitHub]
 */
githubRoutes.get(
  "/oauth/callback",
  validateQuery(OAuthCallbackQuerySchema),
  githubController.oauthCallback
);

/**
 * @swagger
 * /github/install:
 *   post:
 *     summary: Save a GitHub App installation after redirect back from GitHub
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 */
githubRoutes.post(
  "/install",
  authMiddleware,
  validate(InstallationSchema),
  githubController.saveInstallation
);

/**
 * @swagger
 * /github/installations:
 *   get:
 *     summary: List all GitHub App installations belonging to the current user
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 */
githubRoutes.get("/installations", authMiddleware, githubController.listInstallations);

/**
 * @swagger
 * /github/installations/{installationId}:
 *   delete:
 *     summary: Soft-delete a GitHub App installation
 *     tags: [GitHub]
 *     security:
 *       - bearerAuth: []
 */
githubRoutes.delete(
  "/installations/:installationId",
  authMiddleware,
  githubController.deleteInstallation
);
