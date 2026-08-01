# Coding Standards
> Exact steps and exact shapes. Linked from `rules/backend.md`.

## Adding a new feature — ordered checklist
1. [ ] Create `<module>.types.ts` — domain interfaces and enums
2. [ ] Create `I<Module>Repository` interface in `<module>.types.ts`
3. [ ] Create `<module>.repository.ts` implementing the interface
4. [ ] Create `I<Module>Service` interface in `<module>.types.ts`
5. [ ] Create `<module>.service.ts` implementing the interface
6. [ ] Create `<module>.validator.ts` — Zod schemas for every request body/query
7. [ ] Create `<module>.controller.ts` — thin HTTP handlers
8. [ ] Create `<module>.routes.ts` — mount validators + controller methods
9. [ ] Wire into `src/container.ts` (instantiate, inject)
10. [ ] Mount router in `src/routes/index.ts`
11. [ ] Write unit tests: `__tests__/<module>.service.test.ts`
12. [ ] Write integration tests: `__tests__/<module>.routes.test.ts`
13. [ ] Update `knowledge/domains/<module>.md` with acceptance criteria + edge cases
14. [ ] Update API spec in `knowledge/technical/backend/api-guidelines.md`

→ Full walkthrough: `workflows/implement-feature.md`

## Response envelope (exact shape — never deviate)
```typescript
// src/lib/response.ts
export interface ApiResponse<T = null> {
  success: boolean;
  message: string;
  data: T | null;
}

export const ok = <T>(data: T, message = 'Success'): ApiResponse<T> =>
  ({ success: true, message, data });

export const fail = (message: string): ApiResponse<null> =>
  ({ success: false, message, data: null });
```

## Validation pattern (exact shape)
```typescript
// src/middlewares/validate.middleware.ts
export const validate = (schema: ZodSchema) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(fail(result.error.errors[0].message));
    }
    req.body = result.data; // replace with parsed+stripped data
    next();
  };
```

## Per-endpoint documentation format
Every endpoint documented in `knowledge/technical/backend/api-guidelines.md`:
```
### POST /auth/register
- Auth: none
- Body: { email: string, password: string, name: string }
- Response 201: { success: true, message: "Registered", data: { token, refreshToken, user } }
- Edge cases: → knowledge/domains/auth.md#register
```

## File naming
- `kebab-case` for all files
- `PascalCase` for classes and interfaces
- `camelCase` for methods and variables
- `SCREAMING_SNAKE_CASE` for env var names

## Imports — order (enforced by ESLint)
1. Node built-ins
2. External packages
3. Internal packages (`@codeiq/db`, `@codeiq/types`)
4. Relative imports (deepest first)

## Error classes
```typescript
// src/lib/errors.ts
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string
  ) { super(message); }
}
export class NotFoundError extends AppError { constructor(m: string) { super(m, 404, 'NOT_FOUND'); } }
export class UnauthorizedError extends AppError { constructor(m: string) { super(m, 401, 'UNAUTHORIZED'); } }
export class ForbiddenError extends AppError { constructor(m: string) { super(m, 403, 'FORBIDDEN'); } }
export class ConflictError extends AppError { constructor(m: string) { super(m, 409, 'CONFLICT'); } }
export class BadRequestError extends AppError { constructor(m: string) { super(m, 400, 'BAD_REQUEST'); } }
```
