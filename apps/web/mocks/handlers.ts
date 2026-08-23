import { HttpResponse, http } from "msw";
import type { HttpHandler } from "msw";
import { mockUser } from "./fixtures";

// Per-domain handlers get added here as each module is built — see
// .ai/workflows/frontend-testing.md "MSW setup". These are defaults; individual tests override
// a specific handler via server.use(...) to exercise error paths.
export const handlers: HttpHandler[] = [
  http.post("/api/auth/login", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { token: "mock-access-token", refreshToken: "mock-refresh-token", user: mockUser },
    })
  ),
  http.post("/api/auth/register", () =>
    HttpResponse.json(
      {
        success: true,
        message: "Registered — check your email for a verification code",
        data: { identifier: "mock-otp-identifier", user: mockUser },
      },
      { status: 201 }
    )
  ),
  http.post("/api/auth/verify-otp", () =>
    HttpResponse.json({
      success: true,
      message: "Success",
      data: { token: "mock-access-token", refreshToken: "mock-refresh-token", user: mockUser },
    })
  ),
];
