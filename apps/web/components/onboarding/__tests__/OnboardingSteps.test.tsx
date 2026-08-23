import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { mockInactiveRepo, mockInstallation } from "@/mocks/fixtures";
import { OnboardingSteps } from "../OnboardingSteps";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("OnboardingSteps", () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams()
    );
  });

  it("shows step 1 as current when no installation exists", async () => {
    server.use(
      http.get("/api/github/installations", () =>
        HttpResponse.json({ success: true, message: "Success", data: { installations: [] } })
      )
    );

    renderWithProviders(<OnboardingSteps />);

    expect(await screen.findByRole("button", { name: /install the github app/i })).toBeInTheDocument();
  });

  it("shows step 2 as current with a repo checklist when installation exists with 0 active repos", async () => {
    server.use(
      http.get("/api/github/installations", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { installations: [mockInstallation] },
        })
      ),
      http.get("/api/repos", () =>
        HttpResponse.json({ success: true, message: "Success", data: { repos: [mockInactiveRepo] } })
      )
    );

    renderWithProviders(<OnboardingSteps />);

    expect(await screen.findByText(mockInactiveRepo.fullName)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /activate 0 repositories/i })).toBeDisabled();
  });

  it("toggles repo selection and enables the activate button", async () => {
    server.use(
      http.get("/api/github/installations", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { installations: [mockInstallation] },
        })
      ),
      http.get("/api/repos", () =>
        HttpResponse.json({ success: true, message: "Success", data: { repos: [mockInactiveRepo] } })
      )
    );

    renderWithProviders(<OnboardingSteps />);

    const row = await screen.findByText(mockInactiveRepo.fullName);
    await userEvent.click(row);

    expect(screen.getByRole("button", { name: /activate 1 repository/i })).toBeEnabled();
  });

  it("redirects to /overview after activating selected repos", async () => {
    server.use(
      http.get("/api/github/installations", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { installations: [mockInstallation] },
        })
      ),
      http.get("/api/repos", () =>
        HttpResponse.json({ success: true, message: "Success", data: { repos: [mockInactiveRepo] } })
      )
    );

    renderWithProviders(<OnboardingSteps />);

    const row = await screen.findByText(mockInactiveRepo.fullName);
    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /activate 1 repository/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/overview"));
  });
});
