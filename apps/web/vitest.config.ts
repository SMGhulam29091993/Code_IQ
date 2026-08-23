import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors tsconfig.json's "@/*": ["./*"] — tsc/Next resolve it from tsconfig alone, but
    // Vite (which vitest runs on) needs its own alias entry to match at test-run time.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // lib/api.ts reads NEXT_PUBLIC_API_URL at module-eval time to build axios's baseURL —
    // empty string keeps it a clean relative "/api" so MSW handlers (registered as relative
    // paths, e.g. "/api/auth/login") actually match instead of a literal "undefined/api/..." URL.
    env: {
      NEXT_PUBLIC_API_URL: "",
    },
    coverage: {
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
