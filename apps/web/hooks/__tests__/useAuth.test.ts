import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "@/store/auth.store";
import { useAuth } from "../useAuth";

const mockUser = {
  id: "usr_1",
  email: "test@example.com",
  name: "Test User",
  githubId: null,
  githubLogin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("useAuth", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
  });

  it("returns isAuthenticated=false when no token in store", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("returns isAuthenticated=true when token exists", () => {
    useAuthStore.getState().login("access-token", "refresh-token", mockUser);

    const { result } = renderHook(() => useAuth());

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe("access-token");
  });

  it("returns the current user from store", () => {
    useAuthStore.getState().login("access-token", "refresh-token", mockUser);

    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toEqual(mockUser);
  });
});
