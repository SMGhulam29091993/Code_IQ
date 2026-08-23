# Screens: Auth
> Acceptance criteria, component breakdown, edge cases, and test cases for all auth screens.
> API contract: `knowledge/domains/auth.md`

---

## Screen: Login `/login`

### Components
```
(auth)/login/
├── page.tsx                    ← server component, renders LoginForm
└── _components/
    └── LoginForm.tsx           ← 'use client', owns form state + mutation
```

### Acceptance criteria
- [x] Form fields: email (type=email), password (type=password)
- [x] Submit button disabled while the login mutation is in flight — this must be
  `loginMutation.isPending`, not react-hook-form's `formState.isSubmitting`. `isSubmitting` is
  only `true` while the `onSubmit` handler itself is pending; a handler that calls
  `mutation.mutate()` (fire-and-forget) instead of awaiting it returns synchronously, so
  `isSubmitting` flips back to `false` before the network request even resolves — the button
  re-enables instantly instead of staying disabled through the real request. Caught by actually
  running the component test for this case, not by inspection.
- [x] On success → store tokens in auth store → redirect to `/overview`
- [x] Show inline field errors from Zod on submit (not blur — `useForm()`'s default `mode` is
  `onSubmit`; this doc previously said "on blur" here while its own Test Cases section already
  said "on submit" below, an internal inconsistency resolved in favor of submit-time validation)
- [x] Show API error banner below form on 401 ("Invalid email or password")
- [x] Show API error banner on 429 ("Too many attempts. Try again in 15 minutes.")
- [x] "Forgot password?" link present (links to `/forgot-password` — future screen)
- [x] "Create account" link → `/register`
- [x] Form submission on Enter key (native `<form onSubmit>` behavior — no extra code needed)
- [x] No `console.log` of credentials

### Pseudocode
```
LoginForm:
  schema = z.object({ email: z.string().email('Invalid email format'), password: z.string().min(1, 'Password is required') })
  form = useForm({ resolver: zodResolver(schema) })
  loginMutation = useMutation({
    mutationFn: (data) => api.post('/auth/login', data).then(r => r.data.data),
    onSuccess: ({ token, refreshToken, user }) =>
      authStore.login(token, refreshToken, user)
      router.push('/overview')
    onError: (err) =>
      setApiError(loginErrorMessage(err))  // maps 401/429/network/generic to exact AC strings
  })

  onSubmit(data):
    clearApiError()
    loginMutation.mutate(data)

  render:
    // See knowledge/technical/frontend/component-conventions.md's mandatory form pattern —
    // label + input + role="alert" error paragraph, not an `error` prop on Input.
    <form onSubmit={handleSubmit(onSubmit)}>
      <label htmlFor="email">Email</label>
      <Input id="email" type="email" aria-invalid={!!errors.email} {...register('email')} />
      {errors.email && <p role="alert">{errors.email.message}</p>}
      ...same for password...
      {apiError && <ErrorBanner message={apiError} />}
      <Button type="submit" disabled={loginMutation.isPending}>
        {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
      </Button>
    </form>
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| Submit with empty fields | Zod inline errors, no API call |
| Invalid email format | Zod inline error on email field |
| API returns 401 | Banner: "Invalid email or password" |
| API returns 429 | Banner: "Too many attempts. Try again in 15 minutes." |
| API returns 500 | Banner: "Something went wrong. Please try again." |
| Network offline | Banner: "No internet connection." |
| Already authenticated (visits /login) | Redirect to `/overview` immediately |
| Submit while already submitting | Button disabled, duplicate request prevented |

### Test cases
```typescript
describe('LoginForm', () => {
  it('renders email and password fields')
  it('shows Zod error when email is empty on submit')
  it('shows Zod error when email is invalid format')
  it('shows Zod error when password is empty on submit')
  it('disables submit button while submitting')
  it('calls POST /auth/login with correct payload')
  it('stores tokens in auth store on success')
  it('redirects to /overview on success')
  it('shows API error banner on 401 response')
  it('shows rate limit banner on 429 response')
  it('shows generic error banner on 500 response')
  it('does not call API when form is invalid')
  it('clears API error banner on next submission attempt')
  it('redirects to /overview if user is already authenticated')
})
```

---

## Screen: Register `/register`

### Components
```
(auth)/register/
├── page.tsx
└── _components/
    └── RegisterForm.tsx
```

**Two-step flow, not one.** `POST /auth/register` does not return tokens — it creates the user
and issues an OTP (`.ai/knowledge/domains/auth.md`: "Registration is a two-step flow"). Tokens
only come back from a subsequent `POST /auth/verify-otp`. The original version of this doc
assumed register returned tokens directly (`onSuccess: ({ token, refreshToken, user }) => ...`)
— that pseudocode never matched the actual backend contract and would have shipped a broken
screen. Fixed below to match `auth.service.ts`'s real `RegisterResult` (`{ identifier, user }`).

### Acceptance criteria
- [x] Form fields: name, email, password, confirm password
- [x] Client-side: password === confirmPassword before submit
- [x] Password strength indicator (weak/medium/strong — visual only)
- [x] On successful `POST /auth/register` → same page switches to an inline OTP-entry step (not
  a separate route) — "Check your email", 6-digit code input
- [x] On successful `POST /auth/verify-otp` → store tokens → redirect to `/install`
- [x] Show inline Zod errors per field
- [x] Show API 409 error as inline email field error ("This email is already registered"),
  staying on the register step
- [x] "Already have an account?" link → `/login`
- [x] Terms of service checkbox (must be checked to submit)
- [x] OTP step: "Start over with a different email" returns to the register step

### Pseudocode
```
RegisterForm:
  step: 'register' | 'verify-otp' — local state, same component/page, no route change

  registerSchema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
    email: z.string().email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password too long'),
    confirmPassword: z.string(),
    terms: z.boolean().refine(v => v === true, { message: 'You must accept the terms' }),
  }).refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

  registerMutation = useMutation({
    mutationFn: (data) => api.post('/auth/register', omit(data, ['confirmPassword','terms'])),
    onSuccess: ({ identifier, user }) =>
      setIdentifier(identifier)
      setStep('verify-otp')
    onError: (err) =>
      if err.response?.status === 409:
        form.setError('email', { message: 'This email is already registered' })
      else:
        setApiError(err.response?.data?.message ?? 'Something went wrong')
  })

  // step === 'verify-otp':
  otpSchema = z.object({ otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits') })

  verifyOtpMutation = useMutation({
    mutationFn: (data) => api.post('/auth/verify-otp', { identifier, otp: data.otp }),
    onSuccess: ({ token, refreshToken, user }) =>
      authStore.login(token, refreshToken, user)
      router.push('/install')
    onError: (err) =>
      // Backend throws exact user-facing strings for every documented case
      // (400 OTP expired/invalid, 401 Invalid OTP, 403 too many attempts) — pass
      // err.response.data.message straight through rather than re-deriving it.
      setApiError(err.response?.data?.message ?? 'Something went wrong')
  })
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| Passwords do not match | Zod refine error on confirmPassword field |
| Terms not checked | Zod error: "You must accept the terms" |
| Email already taken (409) | Inline error on email field (not banner), stays on register step |
| Name is only whitespace | Zod error after trim |
| Password > 128 chars | Zod error |
| OTP expired/invalid (400) | Banner shows backend's message, stays on OTP step |
| OTP wrong, under 3 attempts (401) | Banner: "Invalid OTP" |
| OTP wrong on 3rd attempt (403) | Banner shows backend's "too many attempts" message; user must "start over" with a different email — the locked account has no path back on this step |
| User clicks "start over" | Returns to register step, clears apiError, discards `identifier` |

### Test cases
```typescript
describe('RegisterForm', () => {
  it('renders name, email, password, confirmPassword, terms fields')
  it('shows error when passwords do not match')
  it('shows error when terms not checked')
  it('shows inline email error on 409 conflict')
  it('omits confirmPassword and terms from the API payload')
  it('shows password strength indicator')
  it('disables submit while submitting')
  it('shows generic error banner on 500')

  describe('after successful registration (OTP step)', () => {
    it('advances to the OTP step on successful registration')
    it('stores tokens in auth store on successful verification')
    it('redirects to /install on successful verification')
    it("shows the backend's message on an invalid OTP")
    it("returns to the register step via 'start over'")
  })
})
```

---

## Screen: Install GitHub App `/install`

### Acceptance criteria
- [ ] Shows "Connect GitHub" CTA if user has no installations
- [ ] Button triggers `GET /github/oauth/url` → redirects to GitHub OAuth
- [ ] After GitHub redirects back with `?installation_id=xxx` → auto-calls `POST /github/install`
- [ ] On success → redirects to `/repos`
- [ ] Shows installation list if user already has installations (skip re-install)
- [ ] Loading state while fetching installations

### Pseudocode
```
InstallPage:
  { data: installations, isLoading } = useInstallations()

  if isLoading → <InstallPageSkeleton />

  if installations.length > 0:
    render: "You already have GitHub connected" + link to /repos

  else:
    render: <ConnectGitHubButton />

ConnectGitHubButton:
  handleClick():
    { data } = await api.get('/github/oauth/url')
    window.location.href = data.url

// Callback landing (query param: ?installation_id=xxx)
useEffect:
  if searchParams.installation_id:
    await api.post('/github/install', { installationId: Number(searchParams.installation_id) })
    router.push('/repos')
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| `installation_id` param missing on callback | Stay on page, show "Installation failed. Try again." |
| `POST /github/install` returns 404 | Banner: "Installation not found on GitHub." |
| `POST /github/install` returns 409 | Banner shows, redirect to /repos (already installed) |
| GitHub OAuth popup blocked | Explain must allow popup / use full redirect |
| User navigates back from GitHub (no code) | Stay on /install, no error |

### Test cases
```typescript
describe('InstallPage', () => {
  it('shows connect GitHub button when no installations exist')
  it('shows already connected message when installations exist')
  it('calls GET /github/oauth/url on button click')
  it('redirects to GitHub OAuth URL')
  it('calls POST /github/install with installation_id from query param')
  it('redirects to /repos after successful install')
  it('shows error banner when POST /github/install returns 404')
  it('redirects to /repos when install returns 409 (already installed)')
  it('shows skeleton while loading installations')
})
```
