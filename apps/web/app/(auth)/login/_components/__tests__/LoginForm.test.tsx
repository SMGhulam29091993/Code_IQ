import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { HttpResponse, http } from "msw";
import { useRouter } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { useAuthStore } from "@/store/auth.store";
import { LoginForm } from "../LoginForm";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("LoginForm", () => {
  const push = vi.fn();
  const replace = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
    push.mockClear();
    replace.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push, replace });
  });

  it("renders email and password fields", () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows Zod error when email is empty on submit", async () => {
    renderWithProviders(<LoginForm />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email format")).toBeInTheDocument();
  });

  it("shows Zod error when email is invalid format", async () => {
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email format")).toBeInTheDocument();
  });

  it("shows Zod error when password is empty on submit", async () => {
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Password is required")).toBeInTheDocument();
  });

  it("does not call API when form is invalid", async () => {
    let called = false;
    server.use(
      http.post("/api/auth/login", () => {
        called = true;
        return HttpResponse.json({ success: true, message: "Success", data: null });
      })
    );
    renderWithProviders(<LoginForm />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText("Invalid email format");

    expect(called).toBe(false);
  });

  it("calls POST /auth/login with correct payload", async () => {
    let receivedBody: unknown;
    server.use(
      http.post("/api/auth/login", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            token: "access-token",
            refreshToken: "refresh-token",
            user: { id: "usr_1", email: "user@example.com", name: "Ada", githubId: null, githubLogin: null, createdAt: "2026-01-01T00:00:00.000Z" },
          },
        });
      })
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(receivedBody).toEqual({ email: "user@example.com", password: "hunter2!!" })
    );
  });

  it("stores tokens in auth store on success", async () => {
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    expect(useAuthStore.getState().token).toBe("mock-access-token");
  });

  it("redirects to /overview on success", async () => {
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/overview"));
  });

  it("shows API error banner on 401 response", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ success: false, message: "Invalid email or password", data: null }, { status: 401 })
      )
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
  });

  it("shows rate limit banner on 429 response", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ success: false, message: "Too many requests", data: null }, { status: 429 })
      )
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText("Too many attempts. Try again in 15 minutes.")
    ).toBeInTheDocument();
  });

  it("shows generic error banner on 500 response", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ success: false, message: "Internal error", data: null }, { status: 500 })
      )
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Internal error")).toBeInTheDocument();
  });

  it("clears API error banner on next submission attempt", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ success: false, message: "Invalid email or password", data: null }, { status: 401 })
      )
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText("Invalid email or password");

    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({
          success: true,
          message: "Success",
          data: {
            token: "t",
            refreshToken: "r",
            user: { id: "usr_1", email: "user@example.com", name: "Ada", githubId: null, githubLogin: null, createdAt: "2026-01-01T00:00:00.000Z" },
          },
        })
      )
    );
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.queryByText("Invalid email or password")).not.toBeInTheDocument()
    );
  });

  it("redirects to /overview if user is already authenticated", () => {
    useAuthStore.getState().login("token", "refresh", {
      id: "usr_1",
      email: "user@example.com",
      name: "Ada",
      githubId: null,
      githubLogin: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    renderWithProviders(<LoginForm />);

    expect(replace).toHaveBeenCalledWith("/overview");
  });

  it("disables submit button while submitting", async () => {
    server.use(
      http.post(
        "/api/auth/login",
        () =>
          new Promise(() => {
            /* never resolves — button should stay disabled */
          })
      )
    );
    renderWithProviders(<LoginForm />);

    await userEvent.type(screen.getByLabelText("Email"), "user@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2!!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled());
  });

  it("has no accessibility violations", async () => {
    const { container } = renderWithProviders(<LoginForm />);

    expect(await axe(container)).toHaveNoViolations();
  });
});
