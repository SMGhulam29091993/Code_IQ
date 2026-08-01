# Workflow: Code Review

## Checklist (run against every PR)

### Architecture
- [ ] No business logic in controllers
- [ ] No DB calls in services (must go through repository)
- [ ] No concrete class imports crossing layer boundaries
- [ ] New module follows the 6-file pattern in `rules/coding-standards.md`

### Security
- [ ] No hardcoded secrets or credentials
- [ ] Webhook endpoints verify signature before any logic
- [ ] Auth middleware applied to all non-public routes
- [ ] Tenant isolation: every DB query scoped by installationId where relevant
- [ ] No `any` types that could hide injection points

### Testing
- [ ] Every new service method has a unit test
- [ ] Every documented edge case in `knowledge/domains/` has a test case
- [ ] No test mocks the thing being tested (mock the dependency, not the subject)

### API
- [ ] Response uses `ok()` / `fail()` envelope — no bare `res.json()`
- [ ] Validation middleware mounted on route before controller
- [ ] API spec updated in `knowledge/technical/backend/api-guidelines.md`

### State
- [ ] `state/current.md` will be updated as part of this PR
- [ ] `knowledge/domains/` updated if domain logic changed

### Frontend specific
- [ ] No business logic in components (in hooks or API layer)
- [ ] Loading, error, and empty states handled
- [ ] No direct `fetch()` calls — axios `api` client used
- [ ] Accessibility: labels on inputs, alts on images
