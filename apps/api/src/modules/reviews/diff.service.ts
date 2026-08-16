import micromatch from "micromatch";
import type { DiffChunk, DiffFile, IDiffService } from "./review.types";
import type { SanitizedRepoConfig } from "../repos/repo.types";

// Exact shapes from .ai/knowledge/domains/review.md "diff.service.ts".
const CHUNK_SIZE = 300;
const CHUNK_OVERLAP = 20;
const CHUNK_STEP = CHUNK_SIZE - CHUNK_OVERLAP;

export class DiffService implements IDiffService {
  filterFiles(files: DiffFile[], config: SanitizedRepoConfig): DiffFile[] {
    return files.filter(
      (file) =>
        file.patch !== undefined &&
        file.status !== "removed" &&
        !config.ignorePatterns.some((pattern) => matchesIgnorePattern(file.filename, pattern))
    );
  }

  chunkFiles(files: DiffFile[]): DiffChunk[] {
    const chunks: DiffChunk[] = [];
    for (const file of files) {
      const lines = (file.patch ?? "").split("\n");
      if (lines.length <= CHUNK_SIZE) {
        chunks.push({ filename: file.filename, patch: file.patch ?? "", chunkIndex: 0 });
        continue;
      }

      let i = 0;
      let chunkIndex = 0;
      while (i < lines.length) {
        const end = Math.min(i + CHUNK_SIZE, lines.length);
        chunks.push({
          filename: file.filename,
          patch: lines.slice(i, end).join("\n"),
          chunkIndex,
        });
        i += CHUNK_STEP;
        chunkIndex++;
      }
    }
    return chunks;
  }
}

// Slash-less patterns (e.g. "*.test.ts") match the basename at any depth, like .gitignore.
// Patterns with a slash (e.g. "dist/**") match the full path only — micromatch's own
// `{ basename: true }` option applies basename matching even to slash patterns, which isn't
// what repo.md's DEFAULT_REPO_CONFIG.ignorePatterns examples intend.
function matchesIgnorePattern(filename: string, pattern: string): boolean {
  if (pattern.includes("/")) {
    return micromatch.isMatch(filename, pattern);
  }
  return micromatch.isMatch(filename, pattern, { basename: true });
}
