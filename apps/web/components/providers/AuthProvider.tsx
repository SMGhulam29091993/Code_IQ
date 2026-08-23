"use client";

import { type FC, type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth.store";

interface AuthProviderProps {
  children: ReactNode;
}

// Mounted once, high in the tree (app/providers.tsx) — wraps every route including
// (dashboard)'s own auth guard. Rehydration must finish, and `hydrated` must flip true,
// before `children` (and therefore the dashboard guard's own effect) ever mounts — otherwise
// a returning user with a valid persisted session bounces to /login on every refresh, since
// the guard's effect would run against the store's default isAuthenticated: false before this
// one gets a chance to rehydrate it. Rendering null until hydrated enforces that ordering.
export const AuthProvider: FC<AuthProviderProps> = ({ children }) => {
  const [hydrated, setHydrated] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("auth-token");
    const refreshToken = localStorage.getItem("auth-refresh");
    if (token && refreshToken) {
      useAuthStore.getState().rehydrate(token, refreshToken);
    }
    setHydrated(true);

    // Multi-tab logout: logout() removes 'auth-token' in the tab that called it, which fires
    // a 'storage' event in every *other* tab with this page open (never the tab that made the
    // change — the browser's own storage-event semantics). Mirror that logout locally there too.
    function onStorage(event: StorageEvent) {
      if (event.key === "auth-token" && event.newValue === null) {
        useAuthStore.getState().logout();
        router.push("/login?reason=session_expired");
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  if (!hydrated) return null;

  return children;
};
