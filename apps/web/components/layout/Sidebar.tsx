"use client";

import { type FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "@/hooks/useAccount";
import { useInstallations } from "@/hooks/useInstallations";
import { useRepos } from "@/hooks/useRepos";
import { useReviews } from "@/hooks/useReviews";
import { cn } from "@/lib/utils";

// Badge counts are real (repo count, review total), not the mockup's static 6/48 — see
// .ai/knowledge/technical/frontend/design-system.md.
const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/repos", label: "Repos", badge: "repos" as const },
  { href: "/reviews", label: "Reviews", badge: "reviews" as const },
  { href: "/billing", label: "Billing" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/account", label: "Account" },
];

// .ai/knowledge/screens/dashboard-screens.md — sidebar footer (installation switcher + user
// row) was in the mockup from the start but missed in the initial Step 1 scaffold; added here
// once GET /auth/me (Step 8) made a real user row possible.
export const Sidebar: FC = () => {
  const pathname = usePathname();
  const { data: repos } = useRepos();
  const { data: reviews } = useReviews({ limit: 1, page: 1 });
  const { data: installations } = useInstallations();
  const { data: user } = useMe();
  const installation = installations?.[0];

  const badgeCount = (kind: "repos" | "reviews") =>
    kind === "repos" ? repos?.length : reviews?.total;

  return (
    <nav
      aria-label="Main navigation"
      className="flex h-full w-56 flex-col border-r border-border bg-surface"
    >
      <div className="flex items-baseline gap-2 px-5 pb-[18px] pt-[22px]">
        <span className="font-display text-lg font-bold tracking-tight text-text">CodeIQ</span>
        {installation && (
          <span className="rounded border border-accent/30 px-[5px] py-[3px] font-mono text-[9px] uppercase tracking-wide text-accent">
            {installation.planTier.toLowerCase()}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname?.startsWith(item.href);
          const count = item.badge ? badgeCount(item.badge) : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 rounded-button px-3 py-2 text-[13.5px] font-medium text-text2 hover:bg-surface2 hover:text-text",
                isActive && "bg-surface2 text-text"
              )}
            >
              <span>{item.label}</span>
              {count !== undefined && (
                <span className="font-mono text-[10.5px] text-text3">{count}</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 border-t border-border px-3 py-3.5">
        {installation && (
          <Link
            href="/account?tab=workspace"
            className="flex items-center gap-2.5 rounded-button border border-border bg-surface2 px-2.5 py-2 hover:bg-surface3"
          >
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded bg-accent font-display text-[11px] font-bold text-bg">
              {installation.accountLogin.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-text">
                {installation.accountLogin}
              </div>
              <div className="font-mono text-[10.5px] text-text3">
                installation · {installation.accountType.toLowerCase()}
              </div>
            </div>
            <span className="flex-none text-[11px] text-text3">▾</span>
          </Link>
        )}
        {user && (
          <div className="flex items-center gap-2.5 px-2.5">
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-surface3 text-[10px] font-medium text-text2">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate text-xs text-text2">{user.email}</span>
          </div>
        )}
      </div>
    </nav>
  );
};
