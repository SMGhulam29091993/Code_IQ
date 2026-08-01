# Workflow: Implement Feature

## When to use
Any new API endpoint, service method, or frontend screen.

## Steps

### Backend
1. Read `knowledge/domains/<domain>.md` for the feature's acceptance criteria, edge cases, and pseudocode.
2. Create `<module>.types.ts` — interfaces + Zod validators.
3. Implement Repository → Service → Controller → Router (in that order).
4. Write unit tests for the Service layer first (TDD preferred).
5. Write integration tests for the routes.
6. Update `knowledge/domains/<domain>.md` if any edge case was discovered during implementation.
7. Update `knowledge/technical/backend/api-guidelines.md` with the endpoint spec.
8. Run `pnpm test` and `pnpm type-check` — fix all failures before marking done.
9. Update `state/current.md` and `state/completed.md`.

### Frontend
1. Read the matching `knowledge/domains/<domain>.md` for API contract.
2. Read `knowledge/technical/frontend/design-system.md` for component and token reference.
3. Build in this order: types → API hook → component skeleton → full component → tests.
4. Every new screen gets `loading.tsx`, `error.tsx`, and an empty-state render.
5. Run `pnpm test` and `pnpm lint` — fix all failures.
6. Update `state/current.md`.

## Definition of done
- [ ] All acceptance criteria from `knowledge/domains/` are implemented
- [ ] All edge cases have corresponding test cases
- [ ] Type-check passes
- [ ] Tests pass (coverage ≥ 80%)
- [ ] API spec updated (backend) or API hook typed (frontend)
- [ ] State files updated
