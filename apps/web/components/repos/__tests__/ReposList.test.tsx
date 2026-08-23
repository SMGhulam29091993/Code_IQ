import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useRouter } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { mockInactiveRepo, mockRepo } from "@/mocks/fixtures";
import { ReposList } from "../ReposList";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ReposList", () => {
  const push = vi.fn();

  beforeEach(() => {
    push.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push });
    server.use(
      http.get("/api/repos", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: { repos: [mockRepo, mockInactiveRepo] },
        })
      )
    );
  });

  it("renders all repos from the API", async () => {
    renderWithProviders(<ReposList />);

    expect(await screen.findByText(mockRepo.fullName)).toBeInTheDocument();
    expect(screen.getByText(mockInactiveRepo.fullName)).toBeInTheDocument();
  });

  it("filters by active status", async () => {
    renderWithProviders(<ReposList />);
    await screen.findByText(mockRepo.fullName);

    await userEvent.click(screen.getByRole("button", { name: "active" }));

    expect(screen.getByText(mockRepo.fullName)).toBeInTheDocument();
    expect(screen.queryByText(mockInactiveRepo.fullName)).not.toBeInTheDocument();
  });

  it("filters by search input", async () => {
    renderWithProviders(<ReposList />);
    await screen.findByText(mockRepo.fullName);

    await userEvent.type(screen.getByLabelText("Search repositories"), "web-dashboard");

    expect(screen.queryByText(mockRepo.fullName)).not.toBeInTheDocument();
    expect(screen.getByText(mockInactiveRepo.fullName)).toBeInTheDocument();
  });

  it("shows empty state when there are no repos", async () => {
    server.use(
      http.get("/api/repos", () =>
        HttpResponse.json({ success: true, message: "Success", data: { repos: [] } })
      )
    );
    renderWithProviders(<ReposList />);

    expect(await screen.findByText(/connect github to see your repos/i)).toBeInTheDocument();
  });

  it("shows plan limit banner when activation returns 403", async () => {
    server.use(
      http.post("/api/repos/:repoId/activate", () =>
        HttpResponse.json(
          { success: false, message: "Plan limit: upgrade to activate more repos", data: null },
          { status: 403 }
        )
      )
    );
    renderWithProviders(<ReposList />);
    await screen.findByText(mockInactiveRepo.fullName);

    const row = screen.getByLabelText(`Repository ${mockInactiveRepo.fullName}`);
    const toggle = row.querySelector('button[aria-label="Activate"]')!;
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByText(/reached the free tier's repo limit/i)).toBeInTheDocument()
    );
  });

  it("navigates to /repos/[id] on card body click", async () => {
    renderWithProviders(<ReposList />);
    await userEvent.click(await screen.findByText(mockRepo.fullName));

    expect(push).toHaveBeenCalledWith(`/repos/${mockRepo.id}`);
  });
});
