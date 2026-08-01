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
- [ ] Form fields: email (type=email), password (type=password)
- [ ] Submit button disabled while `isSubmitting`
- [ ] On success → store tokens in auth store → redirect to `/overview`
- [ ] Show inline field errors from Zod on blur
- [ ] Show API error banner below form on 401 ("Invalid email or password")
- [ ] Show API error banner on 429 ("Too many attempts. Try again in 15 minutes.")
- [ ] "Forgot password?" link present (links to `/forgot-password` — future screen)
- [ ] "Create account" link → `/register`
- [ ] Form submission on Enter key
- [ ] No `console.log` of credentials

### Pseudocode
```
LoginForm:
  schema = z.object({ email: z.string().email(), password: z.string().min(1) })
  form = useForm({ resolver: zodResolver(schema) })
  loginMutation = useMutation({
    mutationFn: (data) => api.post('/auth/login', data).then(r => r.data.data),
    onSuccess: ({ token, refreshToken, user }) =>
      authStore.login(token, refreshToken, user)
      router.push('/overview')
    onError: (err) =>
      setApiError(err.response?.data?.message ?? 'Something went wrong')
  })

  onSubmit(data):
    clearApiError()
    loginMutation.mutate(data)

  render:
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input id="email" type="email" error={errors.email?.message} {...register('email')} />
      <Input id="password" type="password" error={errors.password?.message} {...register('password')} />
      {apiError && <ErrorBanner message={apiError} />}
      <Button type="submit" loading={isSubmitting}>Sign in</Button>
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

### Acceptance criteria
- [ ] Form fields: name, email, password, confirm password
- [ ] Client-side: password === confirmPassword before submit
- [ ] Password strength indicator (weak/medium/strong — visual only)
- [ ] On success → store tokens → redirect to `/install` (GitHub App install flow)
- [ ] Show inline Zod errors per field
- [ ] Show API 409 error as inline email field error ("This email is already registered")
- [ ] "Already have an account?" link → `/login`
- [ ] Terms of service checkbox (must be checked to submit)

### Pseudocode
```
RegisterForm:
  schema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    password: z.string().min(8).max(128),
    confirmPassword: z.string(),
    terms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms' }) }),
  }).refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

  registerMutation = useMutation({
    mutationFn: (data) => api.post('/auth/register', omit(data, ['confirmPassword','terms'])),
    onSuccess: ({ token, refreshToken, user }) =>
      authStore.login(token, refreshToken, user)
      router.push('/install')
    onError: (err) =>
      if err.response?.status === 409:
        form.setError('email', { message: 'This email is already registered' })
      else:
        setApiError(err.response?.data?.message ?? 'Something went wrong')
  })
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| Passwords do not match | Zod refine error on confirmPassword field |
| Terms not checked | Zod error: "You must accept the terms" |
| Email already taken (409) | Inline error on email field (not banner) |
| Name is only whitespace | Zod error after trim |
| Password > 128 chars | Zod error |

### Test cases
```typescript
describe('RegisterForm', () => {
  it('renders name, email, password, confirmPassword, terms fields')
  it('shows error when passwords do not match')
  it('shows error when terms not checked')
  it('shows inline email error on 409 conflict')
  it('redirects to /install on successful registration')
  it('omits confirmPassword and terms from API payload')
  it('stores tokens in auth store on success')
  it('shows password strength indicator')
  it('disables submit while submitting')
  it('shows generic error banner on 500')
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
