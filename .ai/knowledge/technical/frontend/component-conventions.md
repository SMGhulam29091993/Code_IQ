# Frontend Component Conventions
> Exact patterns every component must follow. No exceptions.

## File anatomy (every component)
```typescript
// components/reviews/ReviewCard.tsx

'use client'  // only if using hooks/browser APIs; omit for pure server components

import { type FC } from 'react'
// External
import { motion } from 'framer-motion'
// Internal packages
import { type Review } from '@codeiq/types'
// Relative
import { SeverityBadge } from './SeverityBadge'
import { cn } from '@/lib/utils'

// 1. Props interface — always explicit, never inline
interface ReviewCardProps {
  review: Review
  onClick?: () => void
  className?: string
}

// 2. Component — named export (default export only for Next.js pages)
export const ReviewCard: FC<ReviewCardProps> = ({ review, onClick, className }) => {
  return (
    <div
      className={cn('...base classes...', className)}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick?.()}
      aria-label={`Review for PR #${review.prNumber}: ${review.prTitle}`}
    >
      {/* ... */}
    </div>
  )
}
```

## Hook anatomy
```typescript
// hooks/useReviews.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { api } from '@/lib/api'
import { type ReviewFilters } from '@codeiq/types'

export const useReviews = (filters: ReviewFilters) => {
  return useQuery({
    queryKey: queryKeys.reviews(filters),
    queryFn: async () => {
      const { data } = await api.get('/reviews', { params: filters })
      return data.data  // unwrap ApiResponse envelope
    },
    staleTime: 30_000,
  })
}

export const useRetryReview = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reviewId: string) => api.post(`/reviews/${reviewId}/retry`).then(r => r.data.data),
    onSuccess: (_, reviewId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.review(reviewId) })
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
    },
  })
}
```

## Page anatomy (Next.js App Router)
```
app/(dashboard)/reviews/
├── page.tsx          ← server component; passes searchParams to client component
├── loading.tsx       ← Suspense fallback; renders <ReviewsListSkeleton />
├── error.tsx         ← error boundary; renders <ErrorBanner />
└── [reviewId]/
    ├── page.tsx
    ├── loading.tsx
    └── error.tsx
```

```typescript
// page.tsx — server component
import { ReviewsList } from '@/components/reviews/ReviewsList'

interface PageProps {
  searchParams: { page?: string; status?: string; repoId?: string }
}

export default function ReviewsPage({ searchParams }: PageProps) {
  // Server components: no hooks, no browser APIs
  // Pass searchParams to client component that owns the query
  return <ReviewsList initialFilters={searchParams} />
}
```

```typescript
// loading.tsx
import { ReviewsListSkeleton } from '@/components/reviews/ReviewsListSkeleton'
export default function Loading() { return <ReviewsListSkeleton /> }
```

```typescript
// error.tsx
'use client'
import { ErrorBanner } from '@/components/ui/ErrorBanner'
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorBanner message={error.message} onRetry={reset} />
}
```

## Skeleton pattern (every list/detail component)
```typescript
export const ReviewCardSkeleton: FC = () => (
  <div className="animate-pulse bg-surface rounded-xl p-4 border border-border">
    <div className="h-4 bg-surface3 rounded w-3/4 mb-2" />
    <div className="h-3 bg-surface3 rounded w-1/2" />
  </div>
)
```

## Empty state pattern
```typescript
// Every list component handles empty separately from loading
if (!isLoading && reviews.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text3">
      <span className="text-4xl mb-4">🔍</span>
      <p className="text-sm">No reviews yet. Open a PR in a connected repo to get started.</p>
    </div>
  )
}
```

## Form pattern (react-hook-form + Zod — mandatory)
```typescript
'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})
type FormData = z.infer<typeof schema>

export const LoginForm: FC = () => {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })
  const onSubmit = async (data: FormData) => { /* call mutation */ }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <label htmlFor="email" className="...">Email</label>
      <input id="email" type="email" aria-invalid={!!errors.email} {...register('email')} />
      {errors.email && <p role="alert" className="text-red text-xs">{errors.email.message}</p>}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
```

## Polling pattern (for PENDING/RUNNING reviews)
```typescript
const { data: review } = useQuery({
  queryKey: queryKeys.review(reviewId),
  queryFn: () => api.get(`/reviews/${reviewId}`).then(r => r.data.data),
  refetchInterval: (data) => {
    // Poll every 5s while PENDING or RUNNING; stop when DONE or FAILED
    if (!data || data.status === 'PENDING' || data.status === 'RUNNING') return 5_000
    return false
  },
})
```
