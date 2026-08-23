import { useAuthStore } from "@/store/auth.store";

// See .ai/knowledge/technical/frontend/hooks-and-utils.md "useAuth" and .ai/rules/frontend.md
// "Auth guard pattern" — every (dashboard) layout checks auth through this hook, not the raw
// store, so the guard logic has one place to change.
export const useAuth = () => {
  const { user, token, isAuthenticated, login, logout } = useAuthStore();
  return { user, token, isAuthenticated, login, logout };
};
