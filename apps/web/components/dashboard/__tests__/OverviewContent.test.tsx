import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { useRouter } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { OverviewContent } from "../OverviewContent";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("OverviewContent", () => {
  beforeEach(() => {
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push: vi.fn() });
  });

  it("renders 4 stat cards from GET /reviews/stats", async () => {
    renderWithProviders(<OverviewContent />);

    expect(await screen.findByText("148")).toBeInTheDocument(); // totalReviews
    expect(screen.getByText("412")).toBeInTheDocument(); // totalIssues
    expect(screen.getByText("9")).toBeInTheDocument(); // critical
  });

  it("renders recent reviews from GET /reviews", async () => {
    renderWithProviders(<OverviewContent />);

    expect(
      await screen.findByText("Add idempotency keys to webhook handler")
    ).toBeInTheDocument();
  });

  it("shows empty state when there are no reviews", async () => {
    server.use(
      http.get("/api/reviews", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { reviews: [], total: 0, page: 1, totalPages: 0 },
        })
      )
    );

    renderWithProviders(<OverviewContent />);

    expect(await screen.findByText(/no reviews yet/i)).toBeInTheDocument();
  });

  it("shows an error banner for the stats section when the stats request fails, independent of reviews", async () => {
    server.use(
      http.get("/api/reviews/stats", () => HttpResponse.json({ success: false, message: "Internal error", data: null }, { status: 500 }))
    );

    renderWithProviders(<OverviewContent />);

    await waitFor(() => expect(screen.getByText("Couldn't load review stats.")).toBeInTheDocument());
    expect(await screen.findByText("Add idempotency keys to webhook handler")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<OverviewContent />);
    await screen.findByText("148");

    expect(await axe(container)).toHaveNoViolations();
  });
});
