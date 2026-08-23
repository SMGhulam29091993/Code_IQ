import type { User } from "@codeiq/types";
import { create } from "zustand";

// Shape from .ai/knowledge/technical/frontend/state-conventions.md. Persistence is two
// discrete localStorage keys ('auth-token', 'auth-refresh'), not a single zustand
// `persist` blob — that's what lets the Step 2 AuthProvider read them directly on
// mount without a hydration-mismatch dance. This store writes those keys as a side
// effect of its actions; rehydrating them into state on load is AuthProvider's job.
interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, refreshToken: string, user: User) => void;
  // AuthProvider-only: restores a session from localStorage on mount. No `user` param — there's
  // no GET /auth/me endpoint yet to refetch it, so `user` stays whatever it already was (null on
  // a fresh page load). isAuthenticated flips true on token presence alone.
  rehydrate: (token: string, refreshToken: string) => void;
  setToken: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  login: (token, refreshToken, user) => {
    localStorage.setItem("auth-token", token);
    localStorage.setItem("auth-refresh", refreshToken);
    set({ token, refreshToken, user, isAuthenticated: true });
  },
  rehydrate: (token, refreshToken) => {
    set({ token, refreshToken, isAuthenticated: true });
  },
  setToken: (token) => {
    localStorage.setItem("auth-token", token);
    set({ token });
  },
  logout: () => {
    localStorage.removeItem("auth-token");
    localStorage.removeItem("auth-refresh");
    set({ token: null, refreshToken: null, user: null, isAuthenticated: false });
  },
}));
