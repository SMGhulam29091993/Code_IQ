"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { RepoConfig } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useRepoConfig, useRepoStats, useUpdateRepoConfig } from "@/hooks/useRepos";
import { cn, getErrorMessage, isValidGlob } from "@/lib/utils";

interface RepoConfigPanelProps {
  repoId: string;
}

const SEVERITY_OPTIONS = [
  { value: "CRITICAL" as const, hint: "blockers only" },
  { value: "WARNING" as const, hint: "schema default" },
  { value: "INFO" as const, hint: "post everything" },
];

const CATEGORY_OPTIONS: RepoConfig["enabledCategories"] = [
  "bug",
  "security",
  "performance",
  "logic",
  "style",
];

const schema = z.object({
  severityThreshold: z.enum(["CRITICAL", "WARNING", "INFO"]),
  enabledCategories: z
    .array(z.enum(["bug", "security", "style", "performance", "logic"]))
    .min(1, "Select at least one category"),
  ignorePatterns: z.array(z.string()),
  reviewOnDraft: z.boolean(),
  postSummaryComment: z.boolean(),
});
type FormData = z.infer<typeof schema>;

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repo Detail" — Configuration tab.
export const RepoConfigPanel: FC<RepoConfigPanelProps> = ({ repoId }) => {
  const { data: config, isLoading, error, refetch } = useRepoConfig(repoId);
  const { data: stats } = useRepoStats(repoId);
  const updateMutation = useUpdateRepoConfig(repoId);
  const [patternInput, setPatternInput] = useState("");
  const [patternError, setPatternError] = useState<string | null>(null);

  const form = useForm<FormData>({ resolver: zodResolver(schema) });
  const { watch, setValue, handleSubmit, reset, formState } = form;

  useEffect(() => {
    if (config) reset(config);
  }, [config, reset]);

  const values = watch();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <LoadingSkeleton className="h-96 w-full" />
        <LoadingSkeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error || !config) {
    return <ErrorBanner message="Couldn't load repo configuration." onRetry={() => refetch()} />;
  }

  function toggleCategory(cat: RepoConfig["enabledCategories"][number]) {
    const next = values.enabledCategories.includes(cat)
      ? values.enabledCategories.filter((c) => c !== cat)
      : [...values.enabledCategories, cat];
    setValue("enabledCategories", next, { shouldDirty: true });
  }

  function addPattern() {
    const pattern = patternInput.trim();
    if (!pattern) return;
    if (!isValidGlob(pattern)) {
      setPatternError(`Invalid glob pattern: ${pattern}`);
      return;
    }
    setPatternError(null);
    setValue("ignorePatterns", [...values.ignorePatterns, pattern], { shouldDirty: true });
    setPatternInput("");
  }

  function removePattern(pattern: string) {
    setValue(
      "ignorePatterns",
      values.ignorePatterns.filter((p) => p !== pattern),
      { shouldDirty: true }
    );
  }

  function onSubmit(data: FormData) {
    // Non-null: onSubmit is only reachable via the form below, which doesn't render until the
    // `!config` guard above has already returned — config is loaded by construction here.
    const loadedConfig = config!;
    const changed = (Object.keys(data) as Array<keyof FormData>).reduce<Partial<FormData>>(
      (acc, key) => {
        if (JSON.stringify(data[key]) !== JSON.stringify(loadedConfig[key])) {
          (acc as Record<string, unknown>)[key] = data[key];
        }
        return acc;
      },
      {}
    );
    if (Object.keys(changed).length === 0) return; // no-op — nothing changed
    updateMutation.mutate(changed, { onSuccess: () => reset(data) });
  }

  const enabledCount = values.enabledCategories?.length ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <div className="rounded-card border border-border bg-surface p-5">
          <div className="font-display text-sm font-semibold text-text">Severity threshold</div>
          <p className="mt-1.5 mb-4 text-xs leading-relaxed text-text2">
            Issues below this level are recorded in the dashboard but never posted to the pull
            request.
          </p>
          <div className="flex gap-2">
            {SEVERITY_OPTIONS.map((opt) => {
              const active = values.severityThreshold === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setValue("severityThreshold", opt.value, { shouldDirty: true })}
                  className={cn(
                    "flex-1 rounded-lg border p-3 text-left transition-colors",
                    active ? "border-accent/40 bg-accent/10" : "border-border bg-transparent"
                  )}
                >
                  <div
                    className={cn(
                      "font-mono text-xs font-medium",
                      active ? "text-accent" : "text-text2"
                    )}
                  >
                    {opt.value}
                  </div>
                  <div className="mt-1.5 text-[11px] text-text3">{opt.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <div className="font-display text-sm font-semibold text-text">Enabled categories</div>
          <p className="mt-1.5 mb-4 text-xs leading-relaxed text-text2">
            Click to toggle. Disabled categories are left out of the prompt entirely.
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((cat) => {
              const on = values.enabledCategories?.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  aria-pressed={on}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                    on ? "border-border2 bg-surface2 text-text" : "border-border text-text3"
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-accent" : "bg-text3")} />
                  {cat}
                </button>
              );
            })}
          </div>
          {formState.errors.enabledCategories && (
            <p role="alert" className="mt-3 text-xs text-red">
              {formState.errors.enabledCategories.message}
            </p>
          )}
        </div>

        <div className="rounded-card border border-border bg-surface p-5">
          <div className="mb-3 font-display text-sm font-semibold text-text">Ignore patterns</div>
          <div className="mb-3 flex flex-wrap gap-2">
            {values.ignorePatterns?.map((pattern) => (
              <span
                key={pattern}
                className="flex items-center gap-2 rounded border border-border bg-surface2 px-2.5 py-1.5 font-mono text-xs text-text2"
              >
                {pattern}
                <button
                  type="button"
                  onClick={() => removePattern(pattern)}
                  aria-label={`Remove ${pattern}`}
                  className="text-text3 hover:text-text"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <Input
            placeholder="Add a glob, e.g. packages/db/generated/**"
            value={patternInput}
            onChange={(e) => setPatternInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPattern();
              }
            }}
            className="font-mono"
          />
          {patternError && (
            <p role="alert" className="mt-1 text-xs text-red">
              {patternError}
            </p>
          )}
        </div>

        <div className="rounded-card border border-border bg-surface px-5">
          {[
            {
              key: "reviewOnDraft" as const,
              label: "Review draft pull requests",
              hint: "Drafts are skipped by default, to keep Gemini spend on work that is ready.",
            },
            {
              key: "postSummaryComment" as const,
              label: "Post a PR-level summary comment",
              hint: "One comment with the overall verdict, in addition to the inline comments.",
            },
          ].map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between gap-6 border-b border-white/5 py-4 last:border-b-0"
            >
              <div>
                <div className="text-sm font-medium text-text">{s.label}</div>
                <div className="mt-1 text-xs text-text2">{s.hint}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={values[s.key]}
                onClick={() => setValue(s.key, !values[s.key], { shouldDirty: true })}
                className={cn(
                  "flex h-6 w-10 flex-none items-center rounded-full border p-0.5 transition-colors",
                  values[s.key] ? "justify-end border-accent bg-accent/90" : "justify-start border-border2 bg-surface3"
                )}
              >
                <span className="h-4 w-4 rounded-full bg-bg" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save configuration"}
          </Button>
          <span className="font-mono text-xs text-text3">
            {formState.isDirty ? "unsaved changes" : "saved"}
          </span>
        </div>
        {updateMutation.isError && <ErrorBanner message={getErrorMessage(updateMutation.error)} />}
      </form>

      <div className="rounded-card border border-border bg-surface p-5">
        <div className="mb-4 font-display text-sm font-semibold text-text">
          Effect of this config
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-text3">
              Categories on
            </div>
            <div className="mt-1.5 font-display text-xl font-semibold text-accent">
              {enabledCount} of 5
            </div>
            <div className="mt-1 text-xs text-text2">
              {enabledCount ? values.enabledCategories.join(", ") : "nothing enabled — CodeIQ would post no comments at all."}
            </div>
          </div>
          {stats && (
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wide text-text3">
                Issues by severity
              </div>
              <div className="mt-1.5 text-xs text-text2">
                {stats.issuesBySeverity.critical} critical · {stats.issuesBySeverity.warning}{" "}
                warning · {stats.issuesBySeverity.info} info
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-text3">
          Applies to pull requests opened after saving. Reviews already posted keep the config
          they ran with.
        </div>
      </div>
    </div>
  );
};
