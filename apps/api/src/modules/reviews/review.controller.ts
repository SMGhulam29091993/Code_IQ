import type { Request, Response } from "express";
import type { GetStatsFilters, IReviewService, ListReviewsFilters } from "./review.types";
import { ok } from "../../lib/response";

// Thin HTTP handlers only — all business logic lives in ReviewService.
export class ReviewController {
  constructor(private readonly reviewService: IReviewService) {}

  listReviews = async (req: Request, res: Response) => {
    const result = await this.reviewService.listReviews(
      req.user!.id,
      req.query as unknown as ListReviewsFilters
    );
    res.status(200).json(ok(result));
  };

  getReview = async (req: Request, res: Response) => {
    const result = await this.reviewService.getReview(
      req.user!.id,
      req.params.reviewId as string
    );
    res.status(200).json(ok(result));
  };

  retryReview = async (req: Request, res: Response) => {
    const result = await this.reviewService.retryReview(
      req.user!.id,
      req.params.reviewId as string
    );
    res.status(200).json(ok(result));
  };

  getStats = async (req: Request, res: Response) => {
    const result = await this.reviewService.getStats(
      req.user!.id,
      req.query as unknown as GetStatsFilters
    );
    res.status(200).json(ok(result));
  };
}
