import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPO_CONFIG } from "../modules/repos/repo.types";

// memory/pitfalls.md #010: schema.prisma's RepoConfig column defaults drifted from
// DEFAULT_REPO_CONFIG (the documented defaults) — ignorePatterns lacked "node_modules/**" until
// 2026-10-08. The repository layer always writes every field explicitly, so the drift was
// invisible; this test makes the next one fail loudly instead.
const schema = readFileSync(path.resolve(__dirname, "../../../../packages/db/prisma/schema.prisma"), "utf8");

function schemaDefault(field: string): string {
  const model = /model RepoConfig \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
  const line = model.split("\n").find((l) => new RegExp(`^\\s*${field}\\s`).test(l));
  const match = line && /@default\((.*)\)/.exec(line);
  if (!match) throw new Error(`No @default for RepoConfig.${field} in schema.prisma`);
  return match[1]!;
}

describe("RepoConfig schema defaults match DEFAULT_REPO_CONFIG", () => {
  it.each(["ignorePatterns", "enabledCategories"] as const)("%s", (field) => {
    expect(JSON.parse(schemaDefault(field))).toEqual(DEFAULT_REPO_CONFIG[field]);
  });

  it("severityThreshold", () => {
    expect(JSON.parse(schemaDefault("severityThreshold"))).toBe(DEFAULT_REPO_CONFIG.severityThreshold);
  });

  it.each(["reviewOnDraft", "postSummaryComment"] as const)("%s", (field) => {
    expect(schemaDefault(field)).toBe(String(DEFAULT_REPO_CONFIG[field]));
  });
});
