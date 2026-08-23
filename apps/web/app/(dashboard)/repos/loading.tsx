import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingSkeleton className="h-9 w-64" />
      <LoadingSkeleton className="h-64 w-full" />
    </div>
  );
}
