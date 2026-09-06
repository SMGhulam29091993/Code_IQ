import { ReviewDetailContent } from "@/components/reviews/ReviewDetailContent";

interface PageProps {
  params: { reviewId: string };
}

export default function ReviewDetailPage({ params }: PageProps) {
  return <ReviewDetailContent reviewId={params.reviewId} />;
}
