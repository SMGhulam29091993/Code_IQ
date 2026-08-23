import { Suspense } from "react";
import { ReviewsList } from "@/components/reviews/ReviewsList";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function ReviewsPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-semibold text-text">Reviews</h1>
      <Suspense fallback={<LoadingSkeleton className="h-96 w-full" />}>
        <ReviewsList />
      </Suspense>
    </div>
  );
}
