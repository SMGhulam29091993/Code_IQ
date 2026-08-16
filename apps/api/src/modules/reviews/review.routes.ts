import { Router } from "express";
import { GetStatsQuerySchema, ListReviewsQuerySchema } from "./review.validator";
import { reviewController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validateQuery } from "../../middlewares/validate.middleware";

export const reviewRoutes = Router();

/**
 * @swagger
 * /reviews:
 *   get:
 *     summary: List PR reviews for the current user's installations
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 */
reviewRoutes.get(
  "/",
  authMiddleware,
  validateQuery(ListReviewsQuerySchema),
  reviewController.listReviews
);

/**
 * @swagger
 * /reviews/stats:
 *   get:
 *     summary: Aggregate issue stats for the dashboard
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 */
// Mounted before /:reviewId — Express matches routes in order, and "/stats" would otherwise
// be captured by the :reviewId param.
reviewRoutes.get(
  "/stats",
  authMiddleware,
  validateQuery(GetStatsQuerySchema),
  reviewController.getStats
);

/**
 * @swagger
 * /reviews/{reviewId}:
 *   get:
 *     summary: Get a single review with all issues
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 */
reviewRoutes.get("/:reviewId", authMiddleware, reviewController.getReview);

/**
 * @swagger
 * /reviews/{reviewId}/retry:
 *   post:
 *     summary: Re-run a failed review job
 *     tags: [Reviews]
 *     security:
 *       - bearerAuth: []
 */
reviewRoutes.post("/:reviewId/retry", authMiddleware, reviewController.retryReview);
