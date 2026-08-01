# Frontend State Conventions
> One rule per state type. See `rules/frontend.md` for the decision table.

## Tanstack Query — query keys convention
```typescript
// Centralized in lib/query-keys.ts
export const queryKeys = {
  installations: ['installations'] as const,
  repos: (installationId?: string) => ['repos', installationId] as const,
  repoConfig: (repoId: string) => ['repos', repoId, 'config'] as const,
  repoStats: (repoId: string) => ['repos', repoId, 'stats'] as const,
  reviews: (filters: ReviewFilters) => ['reviews', filters] as const,
  review: (reviewId: string) => ['reviews', reviewId] as const,
  reviewStats: (filters: StatsFilters) => ['reviews', 'stats', filters] as const,
  billing: ['billing'] as const,
};
```

## Axios instance (`lib/api.ts`)
```typescript
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL + '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach token
api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: auto-refresh on 401
let isRefreshing = false;
let failedQueue: PromiseQueue = [];

api.interceptors.response.use(
  response => response,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (isRefreshing) {
        return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }))
          .then(token => { original.headers.Authorization = `Bearer ${token}`; return api(original); });
      }
      isRefreshing = true;
      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        const { data } = await axios.post('/api/auth/refresh', { refreshToken });
        useAuthStore.getState().setToken(data.data.token);
        processQueue(null, data.data.token);
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        useAuthStore.getState().logout();
        window.location.href = '/login?reason=session_expired';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);
```

## Zustand stores

### auth.store.ts
```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, refreshToken: string, user: User) => void;
  setToken: (token: string) => void;
  logout: () => void;
}
// Persisted with zustand/middleware persist → localStorage keys: 'auth-token', 'auth-refresh'
```

### installation.store.ts
```typescript
interface InstallationState {
  activeInstallationId: string | null;
  setActiveInstallation: (id: string) => void;
}
// Persisted to localStorage: 'active-installation'
```

## Form pattern (react-hook-form + Zod)
```typescript
const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
type FormData = z.infer<typeof schema>;

const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(schema),
});
```

## Loading states — required patterns
Every data-loading screen must implement:
1. `loading.tsx` — Suspense skeleton (use `<LoadingSkeleton>` component)
2. `error.tsx` — error boundary (use `<ErrorBanner>` component)
3. Empty state — inline when `data.length === 0` (not 404 page)

## Frontend edge case handling
| Scenario | Implementation |
|----------|---------------|
| API 401 (token expired) | axios interceptor auto-refreshes, retries once |
| API 401 (refresh expired) | interceptor calls `logout()` + redirects `/login?reason=session_expired` |
| API 403 | Show `<ErrorBanner message="You don't have access to this resource." />` |
| API 404 | Redirect to `not-found.tsx` |
| API 5xx | Show `<ErrorBanner message="Something went wrong. Try again." />` with retry button |
| Network offline | Show offline banner (listen to `navigator.onLine` event) |
| Two tabs open + logout | `storage` event listener in `AuthProvider` clears state and redirects |
| Review status PENDING/RUNNING | Poll `GET /reviews/:id` every 5s via `refetchInterval` until DONE or FAILED |
