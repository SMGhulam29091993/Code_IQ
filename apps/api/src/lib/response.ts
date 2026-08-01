import type { ApiResponse } from "@codeiq/types";

// Exact shape from .ai/rules/coding-standards.md "Response envelope" — never deviate.
export const ok = <T>(data: T, message = "Success"): ApiResponse<T> => ({
  success: true,
  message,
  data,
});

export const fail = (message: string): ApiResponse<null> => ({
  success: false,
  message,
  data: null,
});
