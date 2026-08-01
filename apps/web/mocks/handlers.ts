import type { HttpHandler } from "msw";

// Per-domain handlers get added here as each module is built — see
// .ai/workflows/frontend-testing.md "MSW setup".
export const handlers: HttpHandler[] = [];
