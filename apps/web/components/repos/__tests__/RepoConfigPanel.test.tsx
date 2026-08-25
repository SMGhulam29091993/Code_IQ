import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { server } from "@/mocks/server";
import { RepoConfigPanel } from "../RepoConfigPanel";

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("RepoConfigPanel", () => {
  it("pre-fills form with current config values", async () => {
    renderWithProviders(<RepoConfigPanel repoId="repo_1" />);

    expect(await screen.findByText("WARNING")).toBeInTheDocument();
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("*.test.ts")).toBeInTheDocument();
  });

  it("shows error when all categories are unchecked", async () => {
    renderWithProviders(<RepoConfigPanel repoId="repo_1" />);
    await screen.findByText("WARNING");

    for (const cat of ["bug", "security", "performance", "logic"]) {
      await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${cat}$`) }));
    }
    await userEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    expect(await screen.findByText("Select at least one category")).toBeInTheDocument();
  });

  it("calls PATCH /repos/:id/config with only the changed field on submit", async () => {
    let receivedBody: unknown;
    server.use(
      http.patch("/api/repos/:repoId/config", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            config: {
              severityThreshold: "CRITICAL",
              enabledCategories: ["bug", "security", "performance", "logic"],
              ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**"],
              reviewOnDraft: false,
              postSummaryComment: true,
            },
          },
        });
      })
    );
    renderWithProviders(<RepoConfigPanel repoId="repo_1" />);
    await screen.findByText("WARNING");

    await userEvent.click(screen.getByText("CRITICAL"));
    await userEvent.click(screen.getByRole("button", { name: /save configuration/i }));

    await waitFor(() => expect(receivedBody).toEqual({ severityThreshold: "CRITICAL" }));
  });

  it("shows 'unsaved changes' while the form is dirty", async () => {
    renderWithProviders(<RepoConfigPanel repoId="repo_1" />);
    await screen.findByText("WARNING");

    expect(screen.getByText("saved")).toBeInTheDocument();
    await userEvent.click(screen.getByText("CRITICAL"));

    expect(screen.getByText("unsaved changes")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<RepoConfigPanel repoId="repo_1" />);
    await screen.findByText("WARNING");

    expect(await axe(container)).toHaveNoViolations();
  });
});
