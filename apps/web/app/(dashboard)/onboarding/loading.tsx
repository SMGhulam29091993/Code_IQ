import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="max-w-2xl">
      <LoadingSkeleton className="mb-8 h-12 w-full" />
      <div className="flex flex-col gap-6">
        <LoadingSkeleton className="h-20 w-full" />
        <LoadingSkeleton className="h-20 w-full" />
        <LoadingSkeleton className="h-20 w-full" />
      </div>
    </div>
  );
}
