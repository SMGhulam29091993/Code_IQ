import { StatsGridSkeleton } from "@/components/dashboard/StatsGrid";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <StatsGridSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <LoadingSkeleton className="h-72 w-full" />
        <LoadingSkeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
