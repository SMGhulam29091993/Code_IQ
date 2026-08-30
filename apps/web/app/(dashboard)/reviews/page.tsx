import { Suspense } from "react";
import { ReviewsList } from "@/components/reviews/ReviewsList";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function ReviewsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96 w-full" />}>
      <ReviewsList />
    </Suspense>
  );
}
