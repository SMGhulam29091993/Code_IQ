import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <LoadingSkeleton className="h-16 w-full" />
      <LoadingSkeleton className="h-96 w-full" />
    </div>
  );
}
