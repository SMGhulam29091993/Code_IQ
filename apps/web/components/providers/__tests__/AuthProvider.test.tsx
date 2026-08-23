import { render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/store/auth.store";
import { AuthProvider } from "../AuthProvider";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

const mockUser = {
  id: "usr_1",
  email: "test@example.com",
  name: "Test User",
  githubId: null,
  githubLogin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AuthProvider", () => {
  const push = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
    push.mockClear();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ push, replace: vi.fn() });
  });

  it("renders children once hydrated", async () => {
    render(
      <AuthProvider>
        <div>content</div>
      </AuthProvider>
    );

    expect(await screen.findByText("content")).toBeInTheDocument();
  });

  it("rehydrates the store from localStorage on mount", async () => {
    localStorage.setItem("auth-token", "stored-token");
    localStorage.setItem("auth-refresh", "stored-refresh");

    render(
      <AuthProvider>
        <div>content</div>
      </AuthProvider>
    );
    await screen.findByText("content");

    expect(useAuthStore.getState().token).toBe("stored-token");
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it("does not rehydrate when localStorage has no session", async () => {
    render(
      <AuthProvider>
        <div>content</div>
      </AuthProvider>
    );
    await screen.findByText("content");

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("calls logout when auth-token is removed in another tab (storage event)", async () => {
    useAuthStore.getState().login("access-token", "refresh-token", mockUser);

    render(
      <AuthProvider>
        <div>content</div>
      </AuthProvider>
    );
    await screen.findByText("content");

    window.dispatchEvent(new StorageEvent("storage", { key: "auth-token", newValue: null }));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(push).toHaveBeenCalledWith("/login?reason=session_expired");
  });

  it("does not call logout for unrelated storage events", async () => {
    useAuthStore.getState().login("access-token", "refresh-token", mockUser);

    render(
      <AuthProvider>
        <div>content</div>
      </AuthProvider>
    );
    await screen.findByText("content");

    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key", newValue: "x" }));

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });
});
