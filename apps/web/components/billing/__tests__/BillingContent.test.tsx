import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { useSearchParams } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { BillingContent } from "../BillingContent";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("BillingContent", () => {
  beforeEach(() => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams()
    );
  });

  it("renders 3 plan cards from GET /billing/plans", async () => {
    renderWithProviders(<BillingContent />);

    expect(await screen.findByText("FREE")).toBeInTheDocument();
    expect(screen.getByText("PRO")).toBeInTheDocument();
    expect(screen.getByText("TEAM")).toBeInTheDocument();
  });

  it("highlights the current plan card from GET /billing/subscription", async () => {
    renderWithProviders(<BillingContent />);

    expect(await screen.findAllByText("current")).toHaveLength(1);
  });

  it("shows success banner when ?success=true is in the URL", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("success=true")
    );

    renderWithProviders(<BillingContent />);

    expect(await screen.findByText(/you're all set/i)).toBeInTheDocument();
  });

  it("shows the free-tier empty state when GET /billing/subscription returns 400", async () => {
    server.use(
      http.get("/api/billing/subscription", () =>
        HttpResponse.json(
          { success: false, message: "No active subscription found", data: null },
          { status: 400 }
        )
      )
    );

    renderWithProviders(<BillingContent />);

    expect(await screen.findByText("No subscription yet")).toBeInTheDocument();
  });

  it("renders seats from GET /billing/seats", async () => {
    renderWithProviders(<BillingContent />);

    expect(await screen.findByText("dparker")).toBeInTheDocument();
    expect(screen.getByText("34 pull requests reviewed")).toBeInTheDocument();
    expect(screen.getByText("no reviews this period")).toBeInTheDocument();
  });

  it("renders invoices from GET /billing/invoices", async () => {
    renderWithProviders(<BillingContent />);

    expect(await screen.findByText("$228.00")).toBeInTheDocument();
  });

  it("calls POST /billing/checkout on plan switch click", async () => {
    let called = false;
    server.use(
      http.post("/api/billing/checkout", () => {
        called = true;
        return HttpResponse.json({
          success: true,
          message: "Success",
          data: { url: "https://checkout.stripe.com/session" },
        });
      })
    );

    renderWithProviders(<BillingContent />);
    await screen.findByText("PRO");

    await userEvent.click(screen.getByRole("button", { name: /switch to pro/i }));

    await waitFor(() => expect(called).toBe(true));
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<BillingContent />);
    await screen.findByText("FREE");

    expect(await axe(container)).toHaveNoViolations();
  });
});
