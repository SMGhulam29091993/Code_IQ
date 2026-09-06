import { Suspense } from "react";
import { RepoDetailTabs } from "@/components/repos/RepoDetailTabs";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

interface PageProps {
  params: { repoId: string };
}

export default function RepoDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96 w-full" />}>
      <RepoDetailTabs repoId={params.repoId} />
    </Suspense>
  );
}
