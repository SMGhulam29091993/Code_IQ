import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../auth.store";

const mockUser = {
  id: "usr_1",
  email: "test@example.com",
  name: "Test User",
  githubId: null,
  githubLogin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("auth.store", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ user: null, token: null, refreshToken: null, isAuthenticated: false });
  });

  describe("login", () => {
    it("sets user, token, refreshToken, and isAuthenticated", () => {
      useAuthStore.getState().login("access-token", "refresh-token", mockUser);

      const state = useAuthStore.getState();
      expect(state.token).toBe("access-token");
      expect(state.refreshToken).toBe("refresh-token");
      expect(state.user).toEqual(mockUser);
      expect(state.isAuthenticated).toBe(true);
    });

    it("persists token and refreshToken to localStorage as discrete keys", () => {
      useAuthStore.getState().login("access-token", "refresh-token", mockUser);

      expect(localStorage.getItem("auth-token")).toBe("access-token");
      expect(localStorage.getItem("auth-refresh")).toBe("refresh-token");
    });
  });

  describe("rehydrate", () => {
    it("sets token, refreshToken, and isAuthenticated without a user", () => {
      useAuthStore.getState().rehydrate("access-token", "refresh-token");

      const state = useAuthStore.getState();
      expect(state.token).toBe("access-token");
      expect(state.refreshToken).toBe("refresh-token");
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toBeNull();
    });

    it("does not write to localStorage (AuthProvider already read it from there)", () => {
      useAuthStore.getState().rehydrate("access-token", "refresh-token");

      expect(localStorage.getItem("auth-token")).toBeNull();
    });
  });

  describe("setToken", () => {
    it("updates token and persists it, leaving other state untouched", () => {
      useAuthStore.getState().login("old-token", "refresh-token", mockUser);

      useAuthStore.getState().setToken("new-token");

      const state = useAuthStore.getState();
      expect(state.token).toBe("new-token");
      expect(state.user).toEqual(mockUser);
      expect(state.refreshToken).toBe("refresh-token");
      expect(localStorage.getItem("auth-token")).toBe("new-token");
    });
  });

  describe("logout", () => {
    it("clears user, token, refreshToken, and isAuthenticated", () => {
      useAuthStore.getState().login("access-token", "refresh-token", mockUser);

      useAuthStore.getState().logout();

      const state = useAuthStore.getState();
      expect(state.token).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
    });

    it("removes both localStorage keys", () => {
      useAuthStore.getState().login("access-token", "refresh-token", mockUser);

      useAuthStore.getState().logout();

      expect(localStorage.getItem("auth-token")).toBeNull();
      expect(localStorage.getItem("auth-refresh")).toBeNull();
    });
  });
});
