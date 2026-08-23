"use client";

import { type FC } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/repos", label: "Repos" },
  { href: "/reviews", label: "Reviews" },
  { href: "/billing", label: "Billing" },
  { href: "/onboarding", label: "Onboarding" },
];

export const Sidebar: FC = () => {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="flex h-full w-56 flex-col gap-1 border-r border-border bg-surface p-4"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-button px-3 py-2 text-sm font-medium text-text2 hover:bg-surface2 hover:text-text",
              isActive && "bg-surface2 text-text"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
};
