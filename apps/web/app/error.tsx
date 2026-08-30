"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

// Catches any render error not already caught by a route segment's own error.tsx — every
// (dashboard) screen has one, but (auth)/login, (auth)/register, and the root "/" redirect
// page don't, so this is their fallback. Errors inside app/layout.tsx itself (font/provider
// setup) skip past this file entirely and need global-error.tsx instead — see that file's note.
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- no error-reporting service wired up yet
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <p className="font-display text-lg font-semibold text-text">Something went wrong.</p>
      <p className="max-w-sm text-sm text-text2">
        An unexpected error occurred. Try again, or head back to the dashboard.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="secondary" onClick={() => (window.location.href = "/overview")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
