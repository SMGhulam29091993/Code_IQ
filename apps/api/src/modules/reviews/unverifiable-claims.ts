// Findings a reviewer can't verify from a single diff fragment: "X is never used", "X is not
// defined", "missing import for X". The LLM sees one chunk of one file's diff (diff.service.ts),
// so the uses/definitions it says are missing are almost always just outside that fragment.
//
// Found 2026-10-08: 6 of the 11 warnings on PR #17 were exactly this, every one false — the
// symbols are used, and ESLint's @typescript-eslint/no-unused-vars (an error in this repo) and
// the TypeScript compiler already check these deterministically. Telling the model not to
// report them (gemini.service.ts's prompt) didn't change qwen2.5-coder:7b's output at all in an
// A/B run on PR #17's real chunks (5 such claims before, 6 after), so they're filtered here too.
//
// Patterns require a symbol-ish subject (variable / import / function / parameter / property /
// "declared" / "assigned") so ordinary prose like "the error is not handled" isn't caught.
const UNVERIFIABLE_SYMBOL_CLAIMS: RegExp[] = [
  /\b(declared|assigned|defined|imported)\b[^\n]{0,60}\b(never|not)\s+(used|read|referenced)\b/i,
  /\bunused\s+(variable|import|function|parameter|property|declaration|code|constant)s?\b/i,
  /\b(variable|import|importing|function|parameter|property|constant)\b[^\n]{0,80}\b(is|are)\s+(never|not)\s+used\b/i,
  /\b(is|are)\s+not\s+defined\b/i,
  /\bmissing\s+imports?\b/i,
  /\bnot\s+imported\b/i,
];

/** True when an issue message is an unused/undefined/missing-import claim (see above). */
export function isUnverifiableSymbolClaim(message: string): boolean {
  return UNVERIFIABLE_SYMBOL_CLAIMS.some((pattern) => pattern.test(message));
}
