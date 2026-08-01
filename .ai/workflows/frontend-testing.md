# Workflow: Frontend Testing

## Testing stack
- **Unit + component:** Vitest + React Testing Library
- **Accessibility:** jest-axe (run on every page-level component)
- **API mocking:** MSW (Mock Service Worker) — no axios mocking
- **Hook testing:** `renderHook` from RTL

## Test file locations
```
components/reviews/ReviewCard.tsx
components/reviews/__tests__/ReviewCard.test.tsx   ← co-located

hooks/useReviews.ts
hooks/__tests__/useReviews.test.ts

app/(dashboard)/reviews/_components/ReviewsList.tsx
app/(dashboard)/reviews/_components/__tests__/ReviewsList.test.tsx
```

## MSW setup (for all component/hook tests that call the API)
```typescript
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/reviews', () =>
    HttpResponse.json({ success: true, message: 'OK', data: { reviews: mockReviews, total: 2, page: 1, totalPages: 1 } })
  ),
  http.get('/api/reviews/:reviewId', ({ params }) =>
    HttpResponse.json({ success: true, message: 'OK', data: mockReview })
  ),
  http.post('/api/reviews/:reviewId/retry', () =>
    HttpResponse.json({ success: true, message: 'OK', data: mockReview })
  ),
  // ... all endpoints used in tests
]

// src/mocks/server.ts
import { setupServer } from 'msw/node'
export const server = setupServer(...handlers)

// vitest.setup.ts
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## Component test template
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReviewCard } from '../ReviewCard'
import { mockReview } from '@/mocks/fixtures'

const renderWithProviders = (ui: ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      {ui}
    </QueryClientProvider>
  )
}

describe('ReviewCard', () => {
  it('renders PR title', () => {
    renderWithProviders(<ReviewCard review={mockReview} />)
    expect(screen.getByText(mockReview.prTitle)).toBeInTheDocument()
  })

  it('is accessible', async () => {
    const { container } = renderWithProviders(<ReviewCard review={mockReview} />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('calls onClick when Enter key pressed', async () => {
    const onClick = vi.fn()
    renderWithProviders(<ReviewCard review={mockReview} onClick={onClick} />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalled()
  })
})
```

## Hook test template
```typescript
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useReviews } from '../useReviews'
import { server } from '@/mocks/server'
import { http, HttpResponse } from 'msw'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

describe('useReviews', () => {
  it('returns reviews from API', async () => {
    const { result } = renderHook(() => useReviews({ page: 1, limit: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.reviews).toHaveLength(2)
  })

  it('returns error state on API failure', async () => {
    server.use(
      http.get('/api/reviews', () => HttpResponse.json({ success: false }, { status: 500 }))
    )
    const { result } = renderHook(() => useReviews({ page: 1, limit: 20 }), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
```

## Accessibility test (run on every page component)
```typescript
it('has no accessibility violations', async () => {
  const { container } = renderWithProviders(<ReviewsPage />)
  await waitFor(() => expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument())
  const results = await axe(container)
  expect(results).toHaveNoViolations()
})
```

## Coverage thresholds (vitest.config.ts)
```typescript
coverage: {
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 75,
  }
}
```

## What to test — decision table
| Type | Test? | Why |
|------|-------|-----|
| Hook data fetching | Yes | Core behaviour |
| Hook error state | Yes | Required by rules/frontend.md |
| Hook mutation onSuccess | Yes | Side effects (invalidation, redirect) |
| Hook mutation onError | Yes | Error handling |
| Component renders data | Yes | Core |
| Component empty state | Yes | Required by rules/frontend.md |
| Component loading state | Yes | Required by rules/frontend.md |
| Component keyboard nav | Yes | Accessibility rule |
| Component `className` prop | No | Implementation detail |
| Tailwind class strings | No | Not meaningful |
| Util functions | Yes | All edge cases |
| Store slice actions | Yes | State correctness |
| Store slice selectors | Yes | Derived state |

## Mock fixtures (`src/mocks/fixtures.ts`)
```typescript
export const mockUser = { id: 'usr_1', email: 'test@example.com', name: 'Test User' }
export const mockInstallation = { id: 'ins_1', githubInstallationId: 123, accountLogin: 'myorg', planTier: 'FREE', isActive: true }
export const mockRepo = { id: 'rep_1', fullName: 'myorg/my-repo', isActive: true, language: 'TypeScript', reviewCount: 5 }
export const mockReview = {
  id: 'rev_1', repoId: 'rep_1', prNumber: 42, prTitle: 'feat: add auth',
  prAuthor: 'ghulam', headSha: 'abc123', status: 'DONE',
  summary: 'Good PR overall. One security concern.',
  filesReviewed: 3, issues: [mockIssue],
}
export const mockIssue = {
  id: 'iss_1', reviewId: 'rev_1', file: 'src/auth.ts', line: 14,
  severity: 'warning', category: 'security',
  message: 'JWT secret may be weak', suggestion: 'Use a 32+ char random secret',
}
```
