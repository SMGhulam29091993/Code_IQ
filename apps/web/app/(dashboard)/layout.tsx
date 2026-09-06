"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { PageTransition } from "@/components/providers/PageTransition";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// Auth guard per .ai/rules/frontend.md "Auth guard pattern". AuthProvider (mounted in
// app/providers.tsx, wrapping this layout) rehydrates a persisted session from localStorage
// and gates rendering until that finishes, so isAuthenticated is already accurate by the time
// this guard's own effect runs.
//
// .ai/plans/frontend.md Step 9 "Mobile responsiveness" — below `lg`, the sidebar becomes an
// off-canvas drawer (fixed, slide-in, backdrop) behind a hamburger button in a mobile-only top
// bar, instead of the always-visible 224px column that made every screen unusable under
// ~1024px. `lg:` is the same breakpoint the dashboard's own two-column panels (Repo Config,
// Review Detail's file rail, Billing) already collapse at, so the drawer and the content below
// it change layout at the same width.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) router.replace("/login");
  }, [isAuthenticated, router]);

  // Closes the drawer after navigating (Sidebar's onNavigate covers link clicks; this also
  // covers browser back/forward, which onNavigate can't see).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  if (!isAuthenticated) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out lg:static lg:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar onNavigate={() => setMobileNavOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-button text-text2 hover:bg-surface2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="font-display text-base font-bold tracking-tight text-text">
            CodeIQ
          </span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
