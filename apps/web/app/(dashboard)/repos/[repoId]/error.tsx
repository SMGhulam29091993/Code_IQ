"use client";

import { ErrorBanner } from "@/components/ui/ErrorBanner";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorBanner message={error.message} onRetry={reset} />;
}
