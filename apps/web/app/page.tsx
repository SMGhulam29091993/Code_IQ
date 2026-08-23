"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

// AuthProvider (app/providers.tsx) has already rehydrated/gated by the time this mounts, so
// isAuthenticated is accurate on first render — no flash before picking a destination.
export default function RootPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    router.replace(isAuthenticated ? "/overview" : "/login");
  }, [isAuthenticated, router]);

  return null;
}
