import { create } from "zustand";

// Shape from .ai/knowledge/technical/frontend/state-conventions.md.
// Persisted to localStorage key 'active-installation'.
interface InstallationState {
  activeInstallationId: string | null;
  setActiveInstallation: (id: string) => void;
}

const STORAGE_KEY = "active-installation";

export const useInstallationStore = create<InstallationState>()((set) => ({
  activeInstallationId: null,
  setActiveInstallation: (id) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ activeInstallationId: id });
  },
}));
