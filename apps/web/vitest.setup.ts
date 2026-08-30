import "@testing-library/jest-dom/vitest";
import { toHaveNoViolations } from "jest-axe";
import { afterAll, afterEach, beforeAll, expect } from "vitest";
import { server } from "./mocks/server";

// .ai/plans/frontend.md Step 9 "axe-core accessibility pass" — registers `toHaveNoViolations()`
// globally so any test file can `import { axe } from "jest-axe"` and assert on it directly.
expect.extend(toHaveNoViolations);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
