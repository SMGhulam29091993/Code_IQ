import { describe, expect, it } from "vitest";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import { DiffService } from "../modules/reviews/diff.service";
import type { DiffFile } from "../modules/reviews/review.types";

function buildConfig(overrides: Partial<SanitizedRepoConfig> = {}): SanitizedRepoConfig {
  return {
    severityThreshold: "WARNING",
    enabledCategories: ["bug", "security", "performance", "logic"],
    ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"],
    reviewOnDraft: false,
    postSummaryComment: true,
    ...overrides,
  };
}

function buildFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return { filename: "src/index.ts", patch: "@@ -1 +1 @@\n-a\n+b", status: "modified", ...overrides };
}

describe("DiffService.filterFiles", () => {
  const service = new DiffService();

  it("excludes binary files (no patch property)", () => {
    const files = [buildFile({ filename: "logo.png", patch: undefined })];
    expect(service.filterFiles(files, buildConfig())).toEqual([]);
  });

  it("excludes deleted files (status: removed)", () => {
    const files = [buildFile({ status: "removed" })];
    expect(service.filterFiles(files, buildConfig())).toEqual([]);
  });

  it("excludes files matching ignore patterns", () => {
    const files = [buildFile({ filename: "src/index.test.ts" })];
    expect(service.filterFiles(files, buildConfig())).toEqual([]);
  });

  it("includes files not matching any ignore pattern", () => {
    const files = [buildFile({ filename: "src/index.ts" })];
    expect(service.filterFiles(files, buildConfig())).toHaveLength(1);
  });

  it("handles empty ignore patterns list", () => {
    const files = [buildFile({ filename: "dist/bundle.js" })];
    expect(service.filterFiles(files, buildConfig({ ignorePatterns: [] }))).toHaveLength(1);
  });

  it("uses glob matching for patterns (e.g. *.test.ts)", () => {
    const files = [
      buildFile({ filename: "a.test.ts" }),
      buildFile({ filename: "b.spec.ts" }),
      buildFile({ filename: "dist/out.js" }),
      buildFile({ filename: "node_modules/pkg/index.js" }),
      buildFile({ filename: "src/kept.ts" }),
    ];
    const result = service.filterFiles(files, buildConfig());
    expect(result.map((f) => f.filename)).toEqual(["src/kept.ts"]);
  });
});

describe("DiffService.prioritizeFiles", () => {
  const service = new DiffService();

  it("sorts files by additions+deletions descending", () => {
    const files = [
      buildFile({ filename: "small.ts", additions: 1, deletions: 0 }),
      buildFile({ filename: "big.ts", additions: 50, deletions: 20 }),
      buildFile({ filename: "medium.ts", additions: 5, deletions: 5 }),
    ];

    const result = service.prioritizeFiles(files);

    expect(result.map((f) => f.filename)).toEqual(["big.ts", "medium.ts", "small.ts"]);
  });

  it("treats files with no additions/deletions info as size 0", () => {
    const files = [
      buildFile({ filename: "unknown-size.ts" }),
      buildFile({ filename: "big.ts", additions: 10, deletions: 0 }),
    ];

    const result = service.prioritizeFiles(files);

    expect(result.map((f) => f.filename)).toEqual(["big.ts", "unknown-size.ts"]);
  });

  it("does not mutate the input array", () => {
    const files = [
      buildFile({ filename: "a.ts", additions: 1 }),
      buildFile({ filename: "b.ts", additions: 10 }),
    ];

    service.prioritizeFiles(files);

    expect(files.map((f) => f.filename)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("DiffService.chunkFiles", () => {
  const service = new DiffService();

  it("returns single chunk for files under 300 lines", () => {
    const patch = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n");
    const chunks = service.chunkFiles([buildFile({ patch })]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ filename: "src/index.ts", patch, chunkIndex: 0 });
  });

  it("splits large files into multiple chunks", () => {
    const patch = Array.from({ length: 650 }, (_, i) => `+line ${i}`).join("\n");
    const chunks = service.chunkFiles([buildFile({ patch })]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.filename === "src/index.ts")).toBe(true);
  });

  it("maintains 20-line overlap between chunks", () => {
    const lines = Array.from({ length: 650 }, (_, i) => `line-${i}`);
    const chunks = service.chunkFiles([buildFile({ patch: lines.join("\n") })]);
    const firstChunkLines = chunks[0]!.patch.split("\n");
    const secondChunkLines = chunks[1]!.patch.split("\n");
    // Last 20 lines of chunk 0 === first 20 lines of chunk 1.
    expect(firstChunkLines.slice(-20)).toEqual(secondChunkLines.slice(0, 20));
  });

  it("correctly numbers chunkIndex", () => {
    const patch = Array.from({ length: 650 }, (_, i) => `+line ${i}`).join("\n");
    const chunks = service.chunkFiles([buildFile({ patch })]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });

  it("handles empty patch string", () => {
    const chunks = service.chunkFiles([buildFile({ patch: "" })]);
    expect(chunks).toEqual([{ filename: "src/index.ts", patch: "", chunkIndex: 0 }]);
  });
});
