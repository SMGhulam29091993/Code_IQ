import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Extracted from RegisterForm.tsx's original inline helpers (auth screens) — same shape needed
// by every mutation added from Step 3 onward, so it's shared here instead of re-copied per form.
export function getApiErrorMessage(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "response" in err) {
    return (err as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function getApiErrorStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "response" in err) {
    return (err as { response?: { status?: number } }).response?.status;
  }
  return undefined;
}

export function getErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const hasResponse = (err as { response?: unknown }).response !== undefined;
    if (!hasResponse) return "No internet connection.";
    return getApiErrorMessage(err) ?? "Something went wrong. Please try again.";
  }
  return "No internet connection.";
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "formatTimeAgo".
export function formatTimeAgo(date: Date | string): string {
  const then = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "groupBy".
export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const k = String(item[key]);
      return { ...acc, [k]: [...(acc[k] ?? []), item] };
    },
    {} as Record<string, T[]>
  );
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "getSeverityColor". Colour + label per
// design-system.md's "severity is colour plus a word" rule — callers still render the label,
// this only supplies the Tailwind classes and icon.
export function getSeverityColor(severity: "critical" | "warning" | "info") {
  return {
    critical: { text: "text-red", bg: "bg-red/10", border: "border-red/20", icon: "🔴" },
    warning: { text: "text-yellow", bg: "bg-yellow/10", border: "border-yellow/20", icon: "🟡" },
    info: { text: "text-blue", bg: "bg-blue/10", border: "border-blue/20", icon: "🔵" },
  }[severity];
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "isValidGlob" — basic client-side check;
// the server validates authoritatively (bracket-balance check in repo.validator.ts).
export function isValidGlob(pattern: string): boolean {
  return pattern.trim().length > 0 && !pattern.includes(" ");
}
