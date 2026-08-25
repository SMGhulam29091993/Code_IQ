import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { mockReviewSummary } from "@/mocks/fixtures";
import { ReviewsList } from "../ReviewsList";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ReviewsList", () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams()
    );
  });

  it("renders list of reviews", async () => {
    renderWithProviders(<ReviewsList />);

    expect(await screen.findByText(mockReviewSummary.prTitle)).toBeInTheDocument();
  });

  it("filters by status and reflects it in the URL", async () => {
    renderWithProviders(<ReviewsList />);
    await screen.findByText(mockReviewSummary.prTitle);

    await userEvent.click(screen.getByRole("button", { name: "FAILED" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/reviews?status=FAILED&page=1"));
  });

  it("shows empty state when no reviews match filters", async () => {
    server.use(
      http.get("/api/reviews", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { reviews: [], total: 0, page: 1, totalPages: 0 },
        })
      )
    );

    renderWithProviders(<ReviewsList />);

    expect(await screen.findByText(/no review matches/i)).toBeInTheDocument();
  });

  it("shows Retry button only on FAILED reviews", async () => {
    server.use(
      http.get("/api/reviews", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            reviews: [
              mockReviewSummary,
              { ...mockReviewSummary, id: "rev_2", status: "FAILED", prTitle: "Failed review" },
            ],
            total: 2,
            page: 1,
            totalPages: 1,
          },
        })
      )
    );

    renderWithProviders(<ReviewsList />);
    await screen.findByText("Failed review");

    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("calls POST /reviews/:id/retry on retry click", async () => {
    let called = false;
    server.use(
      http.get("/api/reviews", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            reviews: [{ ...mockReviewSummary, status: "FAILED" }],
            total: 1,
            page: 1,
            totalPages: 1,
          },
        })
      ),
      http.post("/api/reviews/:reviewId/retry", () => {
        called = true;
        return HttpResponse.json({
          success: true,
          message: "Success",
          data: { review: { ...mockReviewSummary, status: "PENDING" } },
        });
      })
    );

    renderWithProviders(<ReviewsList />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => expect(called).toBe(true));
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<ReviewsList />);
    await screen.findByText(mockReviewSummary.prTitle);

    expect(await axe(container)).toHaveNoViolations();
  });
});
