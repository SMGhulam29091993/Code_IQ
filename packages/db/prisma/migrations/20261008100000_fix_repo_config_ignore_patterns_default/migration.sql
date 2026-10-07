-- AlterTable
-- Align the column default with DEFAULT_REPO_CONFIG.ignorePatterns (memory/pitfalls.md #010).
-- Changes the default for future inserts only; existing RepoConfig rows are untouched.
ALTER TABLE "RepoConfig" ALTER COLUMN "ignorePatterns" SET DEFAULT ARRAY['*.test.ts', '*.spec.ts', 'dist/**', 'node_modules/**']::TEXT[];
