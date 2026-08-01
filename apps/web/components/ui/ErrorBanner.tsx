"use client";

import { type FC } from "react";
import { Button } from "@/components/ui/Button";

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorBanner: FC<ErrorBannerProps> = ({ message, onRetry }) => (
  <div
    role="alert"
    className="flex items-center justify-between gap-4 rounded-card border border-red/20 bg-red/10 p-4 text-sm text-red"
  >
    <span>{message}</span>
    {onRetry && (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);
