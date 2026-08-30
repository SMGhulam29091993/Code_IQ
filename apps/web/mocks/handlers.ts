import { HttpResponse, http } from "msw";
import type { HttpHandler } from "msw";
import {
  mockInstallation,
  mockInvoices,
  mockPlans,
  mockRepo,
  mockRepoConfig,
  mockReview,
  mockReviewSummary,
  mockSeats,
  mockSubscription,
  mockUser,
} from "./fixtures";

// Per-domain handlers get added here as each module is built — see
// .ai/workflows/frontend-testing.md "MSW setup". These are defaults; individual tests override
// a specific handler via server.use(...) to exercise error paths.
export const handlers: HttpHandler[] = [
  http.post("/api/auth/login", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { token: "mock-access-token", refreshToken: "mock-refresh-token", user: mockUser },
    })
  ),
  http.post("/api/auth/register", () =>
    HttpResponse.json(
      {
        success: true,
        message: "Registered — check your email for a verification code",
        data: { identifier: "mock-otp-identifier", user: mockUser },
      },
      { status: 201 }
    )
  ),
  http.post("/api/auth/verify-otp", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { token: "mock-access-token", refreshToken: "mock-refresh-token", user: mockUser },
    })
  ),
  http.get("/api/auth/me", () =>
    HttpResponse.json({ success: true, message: "Success", data: { user: mockUser } })
  ),
  http.patch("/api/auth/me", () =>
    HttpResponse.json({ success: true, message: "Success", data: { user: mockUser } })
  ),
  http.post("/api/auth/change-password", () =>
    HttpResponse.json({ success: true, message: "Password updated", data: null })
  ),
  http.delete("/api/github/installations/:installationId", () =>
    HttpResponse.json({ success: true, message: "Installation removed", data: null })
  ),

  http.get("/api/github/installations", () =>
    HttpResponse.json({ success: true, message: "Success", data: { installations: [mockInstallation] } })
  ),
  http.post("/api/github/install", () =>
    HttpResponse.json({ success: true, message: "Success", data: { installation: mockInstallation } })
  ),

  http.get("/api/repos", () =>
    HttpResponse.json({ success: true, message: "Success", data: { repos: [mockRepo] } })
  ),
  http.get("/api/repos/:repoId", () =>
    HttpResponse.json({ success: true, message: "Success", data: { repo: mockRepo } })
  ),
  http.post("/api/repos/:repoId/activate", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { repo: { ...mockRepo, isActive: true } },
    })
  ),
  http.post("/api/repos/:repoId/deactivate", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { repo: { ...mockRepo, isActive: false } },
    })
  ),
  http.get("/api/repos/:repoId/config", () =>
    HttpResponse.json({ success: true, message: "Success", data: { config: mockRepoConfig } })
  ),
  http.patch("/api/repos/:repoId/config", () =>
    HttpResponse.json({ success: true, message: "Success", data: { config: mockRepoConfig } })
  ),
  http.get("/api/repos/:repoId/stats", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: {
        totalReviews: 128,
        totalIssues: 15,
        issuesBySeverity: { critical: 2, warning: 9, info: 4 },
        issuesByCategory: { bug: 5, security: 3, style: 1, performance: 4, logic: 2 },
        recentTrend: [],
      },
    })
  ),

  http.get("/api/reviews", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { reviews: [mockReviewSummary], total: 1, page: 1, totalPages: 1 },
    })
  ),
  // Must be registered before the /api/reviews/:reviewId handler below — MSW matches path
  // params against literal segments too, so ":reviewId" would otherwise swallow "stats" first.
  http.get("/api/reviews/stats", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: {
        totalReviews: 148,
        totalIssues: 412,
        issuesBySeverity: { critical: 9, warning: 267, info: 136 },
        issuesByCategory: { bug: 132, security: 88, style: 57, performance: 71, logic: 64 },
        recentTrend: [],
      },
    })
  ),
  // Wrapped in `{ review: ... }` — matches the real GetReviewResult/RetryReviewResult envelope
  // (apps/api/src/modules/reviews/review.types.ts), unlike the /reviews list response.
  http.get("/api/reviews/:reviewId", () =>
    HttpResponse.json({ success: true, message: "Success", data: { review: mockReview } })
  ),
  http.post("/api/reviews/:reviewId/retry", () =>
    HttpResponse.json({ success: true, message: "Success", data: { review: mockReview } })
  ),

  http.get("/api/billing/plans", () =>
    HttpResponse.json({ success: true, message: "Success", data: { plans: mockPlans } })
  ),
  http.get("/api/billing/subscription", () =>
    HttpResponse.json({ success: true, message: "Success", data: mockSubscription })
  ),
  http.get("/api/billing/seats", () =>
    HttpResponse.json({ success: true, message: "Success", data: { seats: mockSeats } })
  ),
  http.get("/api/billing/invoices", () =>
    HttpResponse.json({ success: true, message: "Success", data: { invoices: mockInvoices } })
  ),
  http.post("/api/billing/checkout", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { url: "https://checkout.stripe.com/session" },
    })
  ),
  http.post("/api/billing/portal", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { url: "https://billing.stripe.com/session" },
    })
  ),
];
