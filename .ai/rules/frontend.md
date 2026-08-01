# Frontend Rules
> Loaded when task touches `apps/web/**`

## Agent role
Senior frontend engineer. Owns `apps/web/`. Responsible for all Next.js pages, components, state, and API integration.

## Component conventions
- Functional components only. No class components.
- Props typed with explicit interfaces (never `any`).
- One component per file. File name matches component name in kebab-case.
- Co-locate component tests: `components/reviews/ReviewCard.test.tsx`
- No business logic in components — extract to hooks or the API layer.

## State location rules
| State type          | Location                          |
|---------------------|-----------------------------------|
| Server data         | Tanstack Query (`useQuery`)       |
| Mutations           | Tanstack Query (`useMutation`)    |
| Global client state | Zustand store (`store/*.ts`)      |
| Local UI state      | `useState` / `useReducer`         |
| URL state           | `useSearchParams` / `useRouter`   |

Never put server data in Zustand. Never put UI state in Tanstack Query.

## Styling
- Tailwind CSS only. No inline styles. No CSS modules unless Tailwind genuinely can't express it.
- Design tokens: `knowledge/technical/frontend/design-system.md`
- shadcn/ui for primitives (Button, Input, Modal, Badge, etc.). Import from `@/components/ui/`.
- Framer Motion for animations. Only on client components (`'use client'`).

## Accessibility (hard rule)
- Every interactive element is keyboard-navigable.
- Every `<img>` has a descriptive `alt`.
- Every form input has an associated `<label>`.
- Color contrast: WCAG AA minimum.
- No accessibility violations in CI (`axe-core` via `jest-axe`).

## Data fetching pattern
```typescript
// Always use the API client, never fetch() directly
import { api } from '@/lib/api'; // axios instance with interceptors

// In a component:
const { data, isLoading, error } = useQuery({
  queryKey: ['reviews', repoId],
  queryFn: () => api.get(`/reviews?repoId=${repoId}`).then(r => r.data),
});
```

## Error handling pattern
- API errors surface via Tanstack Query's `error` state.
- Show `<ErrorBanner>` component for page-level errors.
- Show inline field errors for form validation.
- Never `console.error` in production — use the error boundary.

## Auth guard pattern
Every `(dashboard)` layout page checks auth via the `useAuth()` hook.
Unauthenticated users are redirected to `/login`.
The auth state lives in `store/auth.store.ts`.

## File structure rules (per route group)
```
app/(dashboard)/reviews/
├── page.tsx              # server component — fetch initial data
├── loading.tsx           # Suspense skeleton
├── error.tsx             # error boundary
└── [reviewId]/
    └── page.tsx
```

## Testing baseline (frontend)
- Unit: every hook, every util function
- Component: render + user interaction via React Testing Library
- Accessibility: `jest-axe` on every page-level component
- No snapshot tests (they break silently)
- Mock API calls with `msw` (Mock Service Worker)

## Knowledge references
| What you need                | Where to look                                              |
|------------------------------|------------------------------------------------------------|
| Component anatomy            | `knowledge/technical/frontend/component-conventions.md`   |
| Hook patterns                | `knowledge/technical/frontend/hooks-and-utils.md`         |
| Screen AC + edge cases + tests | `knowledge/screens/<screen>.md`                          |
| API contract for a screen    | `knowledge/domains/<domain>.md`                           |
| Design tokens + components   | `knowledge/technical/frontend/design-system.md`           |
| State + axios patterns       | `knowledge/technical/frontend/state-conventions.md`       |
| Test setup + MSW             | `workflows/frontend-testing.md`                           |
| Full screen build steps      | `workflows/frontend-implement-screen.md`                  |

## Behavioral rules (frontend-specific)
1. Never import directly from `apps/api/`. Use `packages/types/` for shared interfaces.
2. Every form uses Zod + `react-hook-form`. Never manual validation.
3. Loading states are always handled — no component renders without a loading skeleton or Suspense fallback.
4. Zustand stores are typed. No `any` in store slices.
5. Every screen domain file in `knowledge/screens/` is the source of truth for that screen's AC, edge cases, and test cases. Implement all of them.
6. Update `knowledge/screens/` when a new screen is added. Update `knowledge/technical/frontend/` when a shared pattern changes.
