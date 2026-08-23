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

### `passwordStrength` (`lib/password-strength.ts`)
```typescript
// Visual-only indicator for the Register screen — the actual requirement enforced is the Zod
// schema's min(8)/max(128), not this heuristic. null for an empty password (nothing to show yet).
export type PasswordStrength = 'weak' | 'medium' | 'strong'
export function passwordStrength(password: string): PasswordStrength | null { ... }
```

---

## AuthProvider (`components/providers/AuthProvider.tsx`)

The version below was never actually implemented as written — it destructured `token` from
`useAuthStore()` (always `null` on a fresh page load, since nothing had populated it yet) and
its "rehydrate on mount" effect body was just a comment, no `localStorage` read anywhere. It
would build and typecheck fine while doing nothing on mount — the bug was invisible until
someone actually reloaded a page while logged in and watched the dashboard guard bounce them to
`/login` anyway. Fixed version below actually reads `localStorage`, and — just as importantly —
gates rendering of `children` until that read finishes, because `(dashboard)/layout.tsx`'s own
guard effect fires on mount too; without gating, the guard's effect can run (and redirect, since
`isAuthenticated` still reads `false` at that instant) before this rehydration effect gets a
chance to run first. See `decisions/` — no dedicated ADR, but the reasoning lives in this
component's own comments.

```typescript
'use client'
// Rehydrates auth store on mount + listens for multi-tab logout. Mounted once, high in the
// tree (app/providers.tsx), wrapping every route including (dashboard)'s own guard.
export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [hydrated, setHydrated] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('auth-token')
    const refreshToken = localStorage.getItem('auth-refresh')
    if (token && refreshToken) {
      useAuthStore.getState().rehydrate(token, refreshToken)  // no `user` — no GET /auth/me yet
    }
    setHydrated(true)

    // Multi-tab logout: logout() removes 'auth-token' in the tab that called it, which fires a
    // 'storage' event in every *other* tab with this page open (browsers never fire it in the
    // tab that made the change) — mirror that logout locally there too.
    function onStorage(event: StorageEvent) {
      if (event.key === 'auth-token' && event.newValue === null) {
        useAuthStore.getState().logout()
        router.push('/login?reason=session_expired')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [router])

  if (!hydrated) return null  // blocks children (and their mount-time guards) until rehydrated

  return children
}
```
**Test cases:**
```typescript
describe('AuthProvider', () => {
  it('renders children once hydrated')
  it('rehydrates the store from localStorage on mount')
  it('does not rehydrate when localStorage has no session')
  it('calls logout when auth-token is removed in another tab (storage event)')
  it('does not call logout for unrelated storage events')
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
