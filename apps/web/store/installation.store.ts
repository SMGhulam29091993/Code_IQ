import { create } from "zustand";

// Shape from .ai/knowledge/technical/frontend/state-conventions.md.
// Persisted to localStorage key 'active-installation'.
interface InstallationState {
  activeInstallationId: string | null;
  setActiveInstallation: (id: string) => void;
  // .ai/knowledge/screens/account-screens.md "Workspace tab" — called after a successful
  // DELETE /github/installations/:id, alongside the redirect to /onboarding.
  clearActiveInstallation: () => void;
}

const STORAGE_KEY = "active-installation";

export const useInstallationStore = create<InstallationState>()((set) => ({
  activeInstallationId: null,
  setActiveInstallation: (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ activeInstallationId: id });
  },
  clearActiveInstallation: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ activeInstallationId: null });
  },
}));
