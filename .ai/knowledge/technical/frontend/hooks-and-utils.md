# Frontend Hooks & Utilities
> Every reusable hook and util — what it does, where it lives, its test cases.

---

## Hooks

### useAuth (`hooks/useAuth.ts`)
```typescript
// Returns auth state + computed isAuthenticated
export const useAuth = () => {
  const { user, token, isAuthenticated, login, logout } = useAuthStore()
  return { user, token, isAuthenticated, login, logout }
}
```
**Test cases:**
```typescript
describe('useAuth', () => {
  it('returns isAuthenticated=false when no token in store')
  it('returns isAuthenticated=true when token exists')
  it('returns the current user from store')
})
```

### useInstallations (`hooks/useInstallations.ts`)
```typescript
export const useInstallations = () =>
  useQuery({
    queryKey: queryKeys.installations,
    queryFn: () => api.get('/github/installations').then(r => r.data.data.installations),
  })
```

### useRepos (`hooks/useRepos.ts`)
```typescript
export const useRepos = (filters?: { installationId?: string; isActive?: boolean }) =>
  useQuery({
    queryKey: queryKeys.repos(filters?.installationId),
    queryFn: () => api.get('/repos', { params: filters }).then(r => r.data.data.repos),
  })

export const useActivateRepo = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (repoId: string) => api.post(`/repos/${repoId}/activate`).then(r => r.data.data),
    onMutate: async (repoId) => { /* optimistic update — see dashboard-screens.md */ },
    onError: (_, __, ctx) => qc.setQueryData(queryKeys.repos(), ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['repos'] }),
  })
}

export const useDeactivateRepo = () => { /* mirror of useActivateRepo */ }

export const useRepoConfig = (repoId: string) =>
  useQuery({
    queryKey: queryKeys.repoConfig(repoId),
    queryFn: () => api.get(`/repos/${repoId}/config`).then(r => r.data.data.config),
  })

export const useUpdateRepoConfig = (repoId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<RepoConfig>) =>
      api.patch(`/repos/${repoId}/config`, body).then(r => r.data.data.config),
    onSuccess: (config) => qc.setQueryData(queryKeys.repoConfig(repoId), config),
  })
}
```

### useReviews (`hooks/useReviews.ts`)
```typescript
export const useReviews = (filters: ReviewFilters) =>
  useQuery({
    queryKey: queryKeys.reviews(filters),
    queryFn: () => api.get('/reviews', { params: filters }).then(r => r.data.data),
    keepPreviousData: true,  // smooth pagination
  })

export const useReview = (reviewId: string) =>
  useQuery({
    queryKey: queryKeys.review(reviewId),
    queryFn: () => api.get(`/reviews/${reviewId}`).then(r => r.data.data),
    refetchInterval: (data) =>
      !data || ['PENDING','RUNNING'].includes(data.status) ? 5_000 : false,
  })

export const useRetryReview = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reviewId: string) => api.post(`/reviews/${reviewId}/retry`).then(r => r.data.data),
    onSuccess: (_, reviewId) => {
      qc.invalidateQueries({ queryKey: queryKeys.review(reviewId) })
      qc.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}

export const useReviewStats = (filters?: StatsFilters) =>
  useQuery({
    queryKey: queryKeys.reviewStats(filters ?? {}),
    queryFn: () => api.get('/reviews/stats', { params: filters }).then(r => r.data.data),
    refetchInterval: 60_000,
  })
```

### useBilling (`hooks/useBilling.ts`)
```typescript
export const useCheckout = () => useMutation({
  mutationFn: (body: { planTier: 'PRO'|'TEAM'; seats: number }) =>
    api.post('/billing/checkout', body).then(r => r.data.data),
  onSuccess: ({ url }) => { window.location.href = url },
})

export const useBillingPortal = () => useMutation({
  mutationFn: () => api.post('/billing/portal').then(r => r.data.data),
  onSuccess: ({ url }) => { window.open(url, '_blank') },
})
```

---

## Utility functions (`lib/utils.ts`)

### `cn` — class merging
```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

### `formatTimeAgo`
```typescript
// "2 hours ago", "3 days ago", etc.
export const formatTimeAgo = (date: Date | string): string => { ... }
```
**Test cases:**
```typescript
describe('formatTimeAgo', () => {
  it('returns "just now" for < 1 minute ago')
  it('returns "X minutes ago" for < 1 hour')
  it('returns "X hours ago" for < 1 day')
  it('returns "X days ago" for < 30 days')
  it('returns formatted date for > 30 days')
})
```

### `groupBy`
```typescript
export const groupBy = <T>(arr: T[], key: keyof T): Record<string, T[]> =>
  arr.reduce((acc, item) => {
    const k = String(item[key])
    return { ...acc, [k]: [...(acc[k] ?? []), item] }
  }, {} as Record<string, T[]>)
```
**Test cases:**
```typescript
describe('groupBy', () => {
  it('groups array items by a string key')
  it('returns empty object for empty array')
  it('handles items with same key')
})
```

### `getSeverityColor`
```typescript
export const getSeverityColor = (severity: 'critical'|'warning'|'info') => ({
  critical: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/20', icon: '🔴' },
  warning:  { text: 'text-yellow', bg: 'bg-yellow/10', border: 'border-yellow/20', icon: '🟡' },
  info:     { text: 'text-blue', bg: 'bg-blue/10', border: 'border-blue/20', icon: '🔵' },
}[severity])
```
**Test cases:**
```typescript
describe('getSeverityColor', () => {
  it('returns red tokens for critical')
  it('returns yellow tokens for warning')
  it('returns blue tokens for info')
})
```

### `isValidGlob`
```typescript
// Client-side glob validation (basic — server validates authoritatively)
export const isValidGlob = (pattern: string): boolean =>
  pattern.trim().length > 0 && !pattern.includes(' ')
```

---

## AuthProvider (`components/providers/AuthProvider.tsx`)
```typescript
'use client'
// Rehydrates auth store on mount + listens for multi-tab logout
export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { token, refreshToken, logout } = useAuthStore()

  // Rehydrate on mount
  useEffect(() => {
    if (token) {
      // Verify token is still valid by fetching user silently
      // If 401, interceptor handles refresh or logout
    }
  }, [])

  // Multi-tab logout
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'auth-token' && e.newValue === null) {
        logout()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [logout])

  return <>{children}</>
}
```
**Test cases:**
```typescript
describe('AuthProvider', () => {
  it('calls logout when auth-token is removed in another tab (storage event)')
  it('does not call logout for unrelated storage events')
  it('renders children')
})
```

---

## ErrorBanner (`components/ui/ErrorBanner.tsx`)
```typescript
interface ErrorBannerProps {
  message: string
  onRetry?: () => void
}
export const ErrorBanner: FC<ErrorBannerProps> = ({ message, onRetry }) => (
  <div role="alert" className="bg-red/10 border border-red/20 rounded-lg p-4 text-red text-sm flex items-center justify-between">
    <span>{message}</span>
    {onRetry && <button onClick={onRetry} className="text-xs underline ml-4">Try again</button>}
  </div>
)
```
**Test cases:**
```typescript
describe('ErrorBanner', () => {
  it('renders the message')
  it('has role="alert" for accessibility')
  it('shows retry button when onRetry is provided')
  it('hides retry button when onRetry is not provided')
  it('calls onRetry when retry button clicked')
})
```
