import { type FC } from "react";
import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  className?: string;
}

// Base skeleton primitive — feature-specific skeletons (e.g. ReviewCardSkeleton)
// compose this per .ai/knowledge/technical/frontend/component-conventions.md.
export const LoadingSkeleton: FC<LoadingSkeletonProps> = ({ className }) => (
  <div
    data-testid="skeleton"
    className={cn("animate-pulse rounded-card bg-surface3", className)}
  />
);
