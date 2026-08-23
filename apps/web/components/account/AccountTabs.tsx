"use client";

import { type FC } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useMe } from "@/hooks/useAccount";
import { useInstallations } from "@/hooks/useInstallations";
import { cn } from "@/lib/utils";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { DangerZone } from "./DangerZone";
import { ProfileForm } from "./ProfileForm";
import { NoInstallationState, WorkspacePanel } from "./WorkspacePanel";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "workspace", label: "Workspace" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// .ai/knowledge/screens/account-screens.md "Screen: Account" — one route, 2 tabs, same
// tabbed-page pattern as Repo Detail (dashboard-screens.md).
export const AccountTabs: FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "profile";

  const { data: user, isLoading: userLoading, error: userError } = useMe();
  const { data: installations, isLoading: installationsLoading } = useInstallations();
  const installation = installations?.[0];

  return (
    <div>
      <div className="mb-6 flex gap-6 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => router.push(`/account?tab=${tab.id}`)}
            className={cn(
              "border-b-2 pb-3 text-sm font-medium",
              activeTab === tab.id
                ? "border-accent text-text"
                : "border-transparent text-text2 hover:text-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" &&
        (userError ? (
          <ErrorBanner message="Couldn't load your profile." />
        ) : userLoading || !user ? (
          <LoadingSkeleton className="h-64 w-full max-w-md" />
        ) : (
          <div className="flex flex-col gap-4">
            <ProfileForm user={user} />
            {!user.githubId && <ChangePasswordForm />}
          </div>
        ))}

      {activeTab === "workspace" &&
        (installationsLoading ? (
          <LoadingSkeleton className="h-64 w-full max-w-md" />
        ) : !installation ? (
          <NoInstallationState />
        ) : (
          <div className="flex flex-col gap-4">
            <WorkspacePanel installation={installation} />
            <DangerZone installationId={installation.id} />
          </div>
        ))}
    </div>
  );
};
