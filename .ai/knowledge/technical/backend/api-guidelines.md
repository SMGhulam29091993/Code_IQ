# API Guidelines — Backend Technical Reference
> Live spec for every endpoint. Update in the same commit that changes the endpoint.

## Base URL
Development: `http://localhost:4000/api`
Production: `https://api.codeiq.dev/api`

## Auth header (all JWT-protected routes)
```
Authorization: Bearer <access_token>
```

## Response envelope (all responses)
```json
{ "success": true|false, "message": "...", "data": {} | null }
```

## Pagination
All list endpoints support:
```
?page=1&limit=20
```
Response includes:
```json
{ "data": { "items": [], "total": 0, "page": 1, "totalPages": 0 } }
```

---

## Auth endpoints

### POST /api/auth/register
- Auth: none · Rate: 10/IP/15min
- Body: `{ email, password, name }`
- 201: `{ token, refreshToken, user: { id, email, name, createdAt } }`
- 400: validation error · 409: email taken
- → Edge cases: `knowledge/domains/auth.md#register`

### POST /api/auth/login
- Auth: none · Rate: 10/IP/15min
- Body: `{ email, password }`
- 200: `{ token, refreshToken, user }`
- 400: validation · 401: invalid credentials
- → Edge cases: `knowledge/domains/auth.md#login`

### POST /api/auth/refresh
- Auth: none
- Body: `{ refreshToken }`
- 200: `{ token }`
- 401: invalid/revoked/expired

### POST /api/auth/logout
- Auth: JWT
- Body: `{ refreshToken }`
- 200: `{ message: "Logged out" }`

### GET /api/github/oauth/url
- Auth: JWT
- 200: `{ url: "https://github.com/login/oauth/authorize?..." }`

### GET /api/github/oauth/callback
- Auth: none (CSRF state)
- Query: `{ code, state }`
- 302: redirect to `/install` on success

---

## GitHub App / Installation endpoints

### POST /api/github/install
- Auth: JWT
- Body: `{ installationId: number }`
- 201: `{ installation }`
- 400: validation · 404: not found on GitHub · 409: already registered

### GET /api/github/installations
- Auth: JWT
- 200: `{ installations: [{ id, githubInstallationId, accountLogin, accountType, planTier, repoCount }] }`

### DELETE /api/github/installations/:installationId
- Auth: JWT
- 200: `{ message: "Installation removed" }`
- 403: not owner · 404: not found

---

## Webhook endpoint

### POST /api/webhooks/github
- Auth: HMAC-SHA256 (X-Hub-Signature-256)
- Headers: X-GitHub-Event, X-GitHub-Delivery
- Body: raw GitHub webhook payload
- 200: always (except signature failure)
- 401: signature missing/invalid
- → Full event handling: `knowledge/domains/github-app.md#webhook`

---

## Repo endpoints

### GET /api/repos
- Auth: JWT
- Query: `{ installationId?, isActive? }`
- 200: `{ repos: [{ id, fullName, isActive, language, reviewCount, config }] }`

### POST /api/repos/:repoId/activate
- Auth: JWT
- 200: `{ repo }`
- 403: not owner / plan limit · 404: not found

### POST /api/repos/:repoId/deactivate
- Auth: JWT
- 200: `{ repo }`
- 403: not owner · 404: not found

### GET /api/repos/:repoId/config
- Auth: JWT
- 200: `{ config: RepoConfig }`
- 403: not owner · 404: not found

### PATCH /api/repos/:repoId/config
- Auth: JWT
- Body: `{ severityThreshold?, enabledCategories?, ignorePatterns?, reviewOnDraft?, postSummaryComment? }`
- 200: `{ config: RepoConfig }`
- 400: invalid config · 403: not owner · 404: not found

### GET /api/repos/:repoId/stats
- Auth: JWT
- 200: `{ totalReviews, totalIssues, issuesBySeverity, issuesByCategory, recentTrend }`

---

## Review endpoints

### GET /api/reviews
- Auth: JWT
- Query: `{ repoId?, status?, page?, limit? }`
- 200: `{ reviews, total, page, totalPages }`

### GET /api/reviews/:reviewId
- Auth: JWT
- 200: `{ review: { id, prNumber, prTitle, prAuthor, headSha, status, summary, filesReviewed, issues: ReviewIssue[], createdAt } }`
- 403: not owner · 404: not found

### POST /api/reviews/:reviewId/retry
- Auth: JWT
- 200: `{ review }`
- 400: not FAILED status · 403: not owner · 404: not found

### GET /api/reviews/stats
- Auth: JWT
- Query: `{ repoId?, days? }`
- 200: `{ totalReviews, totalIssues, issuesBySeverity, issuesByCategory, dailyTrend }`

---

## Billing endpoints

### GET /api/billing/plans
- Auth: none
- 200: `{ plans: [{ tier, price, seats, limits }] }`

### POST /api/billing/checkout
- Auth: JWT
- Body: `{ planTier: 'PRO' | 'TEAM', seats: number }`
- 200: `{ url: "https://checkout.stripe.com/..." }`
- 400: already subscribed / invalid tier · 502: Stripe unavailable

### POST /api/billing/portal
- Auth: JWT
- 200: `{ url: "https://billing.stripe.com/..." }`
- 400: no active subscription

### POST /api/billing/webhook
- Auth: Stripe-Signature header
- Body: raw Stripe event (express.raw middleware)
- 200: always (except signature failure)
- 400: signature missing/invalid
