import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { mockInstallation, mockUser } from "@/mocks/fixtures";
import { AccountTabs } from "../AccountTabs";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("AccountTabs", () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push });
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams()
    );
  });

  it("defaults to the Profile tab and pre-fills the form with the current user's name", async () => {
    renderWithProviders(<AccountTabs />);

    expect(await screen.findByDisplayValue(mockUser.name)).toBeInTheDocument();
    expect(screen.getByText(mockUser.email)).toBeInTheDocument();
  });

  it("switches tabs and reflects the choice in the URL", async () => {
    renderWithProviders(<AccountTabs />);
    await screen.findByDisplayValue(mockUser.name);

    await userEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(push).toHaveBeenCalledWith("/account?tab=workspace");
  });

  it("renders ChangePasswordForm for a password account (githubId null)", async () => {
    renderWithProviders(<AccountTabs />);

    expect(await screen.findByText("Change password")).toBeInTheDocument();
  });

  it("does not render ChangePasswordForm for a GitHub-only account", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { user: { ...mockUser, githubId: "gh_123" } },
        })
      )
    );

    renderWithProviders(<AccountTabs />);
    await screen.findByDisplayValue(mockUser.name);

    expect(screen.queryByText("Change password")).not.toBeInTheDocument();
  });

  it("calls PATCH /auth/me with the updated name on save", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch("/api/auth/me", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Success",
          data: { user: { ...mockUser, name: "New Name" } },
        });
      })
    );

    renderWithProviders(<AccountTabs />);
    const nameInput = await screen.findByDisplayValue(mockUser.name);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "New Name");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(receivedBody).toEqual({ name: "New Name" }));
  });

  it("shows workspace info on the Workspace tab", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("tab=workspace")
    );

    renderWithProviders(<AccountTabs />);

    expect(await screen.findByText(mockInstallation.accountLogin)).toBeInTheDocument();
    expect(screen.getByText(mockInstallation.planTier)).toBeInTheDocument();
  });

  it("shows confirm dialog before removing the installation, then calls DELETE and redirects", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("tab=workspace")
    );
    let called = false;
    server.use(
      http.delete("/api/github/installations/:installationId", () => {
        called = true;
        return HttpResponse.json({ success: true, message: "Installation removed", data: null });
      })
    );

    renderWithProviders(<AccountTabs />);
    await screen.findByText(mockInstallation.accountLogin);

    await userEvent.click(screen.getByRole("button", { name: "Remove installation" }));
    expect(called).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Yes, remove it" }));

    await waitFor(() => expect(called).toBe(true));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding"));
  });

  it("does not call the API when the confirm dialog is dismissed", async () => {
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("tab=workspace")
    );
    let called = false;
    server.use(
      http.delete("/api/github/installations/:installationId", () => {
        called = true;
        return HttpResponse.json({ success: true, message: "Installation removed", data: null });
      })
    );

    renderWithProviders(<AccountTabs />);
    await screen.findByText(mockInstallation.accountLogin);

    await userEvent.click(screen.getByRole("button", { name: "Remove installation" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(called).toBe(false);
  });

  it("shows a connect-GitHub empty state when no installation exists", async () => {
    server.use(
      http.get("/api/github/installations", () =>
        HttpResponse.json({ success: true, message: "Success", data: { installations: [] } })
      )
    );
    (useSearchParams as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new URLSearchParams("tab=workspace")
    );

    renderWithProviders(<AccountTabs />);

    expect(await screen.findByText(/no github installation connected/i)).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<AccountTabs />);
    await screen.findByDisplayValue(mockUser.name);

    expect(await axe(container)).toHaveNoViolations();
  });
});
