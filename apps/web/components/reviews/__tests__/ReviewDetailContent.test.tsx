import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useRouter } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { mockReview } from "@/mocks/fixtures";
import { ReviewDetailContent } from "../ReviewDetailContent";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  notFound: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ReviewDetailContent", () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
    });
  });

  it("renders summary and issues grouped by file when DONE", async () => {
    renderWithProviders(<ReviewDetailContent reviewId="rev_1" />);

    expect(await screen.findByText(mockReview.summary!)).toBeInTheDocument();
    expect(screen.getByText(mockReview.issues[0]!.message)).toBeInTheDocument();
  });

  it("shows processing state when status is RUNNING", async () => {
    server.use(
      http.get("/api/reviews/:reviewId", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { review: { ...mockReview, status: "RUNNING", issues: [] } },
        })
      )
    );

    renderWithProviders(<ReviewDetailContent reviewId="rev_1" />);

    expect(await screen.findByText(/reviewing pull request/i)).toBeInTheDocument();
  });

  it("shows failed state with retry button when FAILED", async () => {
    server.use(
      http.get("/api/reviews/:reviewId", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { review: { ...mockReview, status: "FAILED", issues: [] } },
        })
      )
    );

    renderWithProviders(<ReviewDetailContent reviewId="rev_1" />);

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows empty state when review has 0 issues", async () => {
    server.use(
      http.get("/api/reviews/:reviewId", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { review: { ...mockReview, issues: [] } },
        })
      )
    );

    renderWithProviders(<ReviewDetailContent reviewId="rev_1" />);

    expect(await screen.findByText(/no issues found/i)).toBeInTheDocument();
  });

  it("filters issues by severity client-side", async () => {
    server.use(
      http.get("/api/reviews/:reviewId", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            review: {
              ...mockReview,
              issues: [
                mockReview.issues[0]!,
                { ...mockReview.issues[0]!, id: "iss_2", severity: "info", message: "Info issue" },
              ],
            },
          },
        })
      )
    );

    renderWithProviders(<ReviewDetailContent reviewId="rev_1" />);
    await screen.findByText("Info issue");

    await userEvent.click(screen.getByRole("button", { name: "critical" }));

    expect(screen.queryByText("Info issue")).not.toBeInTheDocument();
    expect(screen.getByText(mockReview.issues[0]!.message)).toBeInTheDocument();
  });
});
