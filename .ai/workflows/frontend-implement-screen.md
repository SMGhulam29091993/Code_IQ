# Workflow: Implement a Frontend Screen

## When to use
Building any new page, screen, or significant component group.

## Steps (ordered — complete each before next)

1. **Read the screen domain file**
   Open `knowledge/screens/<screen>.md`. Understand:
   - Components needed and their file locations
   - Acceptance criteria (every checkbox must be implemented)
   - Edge cases (every row must be handled)
   - Test cases (every `it(...)` must exist as a test)

2. **Read the API contract**
   Open the matching `knowledge/domains/<domain>.md` for the API response shapes.
   Open `knowledge/technical/backend/api-guidelines.md` for exact URL + response envelope.

3. **Read the design tokens**
   Open `knowledge/technical/frontend/design-system.md` for colours, typography, components.

4. **Build in this order**
   - [ ] Types (if not already in `packages/types`)
   - [ ] Hook(s) in `hooks/`
   - [ ] Skeleton component (`<ComponentSkeleton />`)
   - [ ] Empty state (inline in component)
   - [ ] Main component
   - [ ] `page.tsx` (server component shell)
   - [ ] `loading.tsx` (renders skeleton)
   - [ ] `error.tsx` (renders ErrorBanner)

5. **Write tests**
   Use `workflows/frontend-testing.md` for setup.
   Every `it(...)` in the screen domain file → one test.
   Every edge case row → one test.
   Accessibility test on every page component.

6. **Self-review against checklist**
   - [ ] All acceptance criteria from `knowledge/screens/` are implemented
   - [ ] All edge cases handled
   - [ ] Loading state: skeleton shown
   - [ ] Empty state: informative message + action if applicable
   - [ ] Error state: ErrorBanner with retry where possible
   - [ ] All interactive elements keyboard-navigable
   - [ ] All form inputs have associated `<label>`
   - [ ] No `any` types
   - [ ] No direct `fetch()` — axios `api` client used
   - [ ] No business logic in component — in hook
   - [ ] Tests written and passing
   - [ ] Accessibility: axe test passes

7. **Update state files**
   Mark step as `completed` in `plans/frontend.md`.
   Update `state/current.md`.

## Definition of done
All checkboxes in step 6 ticked. Tests pass. `pnpm lint` clean. `pnpm type-check` clean.
