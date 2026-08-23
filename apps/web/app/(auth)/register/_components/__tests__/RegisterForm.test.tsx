import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { useRouter } from "next/navigation";
import { type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { useAuthStore } from "@/store/auth.store";
import { RegisterForm } from "../RegisterForm";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

async function fillValidRegisterForm() {
  await userEvent.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "Password123!");
  await userEvent.type(screen.getByLabelText("Confirm password"), "Password123!");
  await userEvent.click(screen.getByLabelText(/agree to the terms/i));
}

describe("RegisterForm", () => {
  const push = vi.fn();
  const replace = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
    push.mockClear();
    replace.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push, replace });
  });

  it("renders name, email, password, confirmPassword, terms fields", () => {
    renderWithProviders(<RegisterForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
    expect(screen.getByLabelText(/agree to the terms/i)).toBeInTheDocument();
  });

  it("shows error when passwords do not match", async () => {
    renderWithProviders(<RegisterForm />);

    await userEvent.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "Password123!");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Different123!");
    await userEvent.click(screen.getByLabelText(/agree to the terms/i));
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
  });

  it("shows error when terms not checked", async () => {
    renderWithProviders(<RegisterForm />);

    await userEvent.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "Password123!");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Password123!");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("You must accept the terms")).toBeInTheDocument();
  });

  it("shows inline email error on 409 conflict", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ success: false, message: "Email already in use", data: null }, { status: 409 })
      )
    );
    renderWithProviders(<RegisterForm />);

    await fillValidRegisterForm();
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("This email is already registered")).toBeInTheDocument();
    // Stays on the register step — no transition to OTP entry on failure.
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument();
  });

  it("omits confirmPassword and terms from the API payload", async () => {
    let receivedBody: unknown;
    server.use(
      http.post("/api/auth/register", async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          {
            success: true,
            message: "Registered",
            data: { identifier: "id-1", user: { id: "usr_1", email: "ada@example.com", name: "Ada", githubId: null, githubLogin: null, createdAt: "2026-01-01T00:00:00.000Z" } },
          },
          { status: 201 }
        );
      })
    );
    renderWithProviders(<RegisterForm />);

    await fillValidRegisterForm();
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(receivedBody).toEqual({
        email: "ada@example.com",
        password: "Password123!",
        name: "Ada Lovelace",
      })
    );
  });

  it("shows password strength indicator", async () => {
    renderWithProviders(<RegisterForm />);

    await userEvent.type(screen.getByLabelText("Password"), "Password123!");

    expect(await screen.findByText(/Strength:/)).toBeInTheDocument();
  });

  it("shows generic error banner on 500", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ success: false, message: "Internal error", data: null }, { status: 500 })
      )
    );
    renderWithProviders(<RegisterForm />);

    await fillValidRegisterForm();
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("Internal error")).toBeInTheDocument();
  });

  it("disables submit while submitting", async () => {
    server.use(
      http.post(
        "/api/auth/register",
        () =>
          new Promise(() => {
            /* never resolves */
          })
      )
    );
    renderWithProviders(<RegisterForm />);

    await fillValidRegisterForm();
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /creating account/i })).toBeDisabled()
    );
  });

  describe("after successful registration (OTP step)", () => {
    async function registerAndReachOtpStep() {
      renderWithProviders(<RegisterForm />);
      await fillValidRegisterForm();
      await userEvent.click(screen.getByRole("button", { name: /create account/i }));
      await screen.findByText("Check your email");
    }

    it("advances to the OTP step on successful registration", async () => {
      await registerAndReachOtpStep();

      expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
    });

    it("stores tokens in auth store on successful verification", async () => {
      await registerAndReachOtpStep();

      await userEvent.type(screen.getByLabelText("Verification code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(true));
    });

    it("redirects to /install on successful verification", async () => {
      await registerAndReachOtpStep();

      await userEvent.type(screen.getByLabelText("Verification code"), "123456");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/install"));
    });

    it("shows the backend's message on an invalid OTP", async () => {
      server.use(
        http.post("/api/auth/verify-otp", () =>
          HttpResponse.json({ success: false, message: "Invalid OTP", data: null }, { status: 401 })
        )
      );
      await registerAndReachOtpStep();

      await userEvent.type(screen.getByLabelText("Verification code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: /verify/i }));

      expect(await screen.findByText("Invalid OTP")).toBeInTheDocument();
    });

    it("returns to the register step via 'start over'", async () => {
      await registerAndReachOtpStep();

      await userEvent.click(screen.getByText(/start over with a different email/i));

      expect(await screen.findByRole("heading", { name: "Create account" })).toBeInTheDocument();
    });
  });
});
