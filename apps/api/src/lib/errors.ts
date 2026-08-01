// Exact shapes from .ai/rules/coding-standards.md "Error classes" — do not deviate.
export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(m: string) {
    super(m, 404, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(m: string) {
    super(m, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(m: string) {
    super(m, 403, "FORBIDDEN");
  }
}

export class ConflictError extends AppError {
  constructor(m: string) {
    super(m, 409, "CONFLICT");
  }
}

export class BadRequestError extends AppError {
  constructor(m: string) {
    super(m, 400, "BAD_REQUEST");
  }
}
