# Domain: Auth
> Source of truth for all authentication logic. Backend + frontend both reference this file.

## Bounded context
Handles user registration, login, token lifecycle, and GitHub identity linking.
Does NOT handle GitHub App installation auth — that belongs to `github-app.md`.

Registration is a two-step flow: `POST /auth/register` creates the user and issues an OTP
instead of tokens; `POST /auth/verify-otp` confirms the OTP and issues tokens. See
[OTP Service](#otp-service-servicesotpservicets) below.

---

## OTP Service (`services/otp.service.ts`)

**Purpose:** Issue and verify the one-time passcode used to confirm a user's email
during registration.

**Schema (`otps` table):**
```typescript
{
  id: string;
  userId: string;            // unique — one active OTP per user
  hashedIdentifier: string;  // sha256(identifier) — used to look up the row
  hashedOtp: string;         // bcrypt(otp)
  expiresAt: Date;           // now + 5 min
  createdAt: Date;
  updatedAt: Date;
}
```

**`OtpService.create(userId)` flow:**
```
create(userId):
  identifier = crypto.randomBytes(32).toString('hex')
  hashedIdentifier = crypto.createHash('sha256').update(identifier).digest('hex')
  otp = randomDigits(6)                                    // e.g. "482913"
  hashedOtp = bcrypt.hash(otp, 10)
  expiresAt = now() + 5 minutes
  otpRepo.upsert({ userId }, { hashedIdentifier, hashedOtp, expiresAt })  // replaces any prior OTP for this user
  redis.set(`otp:${identifier}`, JSON.stringify({ hashedIdentifier, attempts: 0 }), { EX: 300 })
  return { identifier, otp }   // otp goes to the mail service only — it is never returned over HTTP
```

**Open questions / assumptions (flag before implementing):**

- The 3-attempt retry limit has no field in the schema above — tracked here as `attempts`
  inside the Redis entry so it expires alongside the OTP with no migration needed. Move it
  onto the `otps` row instead if attempts need to survive a Redis flush.
- "Locking the user's email" after 3 failed attempts implies a flag outside this schema
  (e.g. `users.status = 'locked'` or `users.otpLockedAt`). Not modeled here since the `users`
  table isn't owned by this file — needs a matching field wherever that table is defined.
- Whether a locked email can ever be unlocked (support action, cooldown, etc.) vs. being
  permanently dead-ended is unspecified — currently documented as permanent ("use a different email").

---

## Mail Service (`services/mail/`)

**Purpose:** Sends transactional email (welcome, OTP, ...) via nodemailer, decoupled from
auth/business logic.
**Pattern:** Factory — `MailServiceFactory.create(type)` returns the sender configured for
that mail type (template + provider config), so `AuthService` never branches on mail type:

```
mailServiceFactory.create('otp').send(user.email, { otp })      // fire-and-forget, same as sendWelcome
mailServiceFactory.create('welcome').send(user.email, { name })
```

---

## API Routes

### POST /auth/register
**Purpose:** Create a new user account and issue an OTP to verify the registered email.
**Auth:** None
**Rate limit:** 10 req / IP / 15 min

**Request body:**
```typescript
{ email: string; password: string; name: string }
```

**Acceptance criteria:**
- [ ] Creates user with hashed password (bcrypt, cost 12)
- [ ] On success, creates an OTP via `OtpService.create(user.id)` (5 min validity, 3 attempts) instead of issuing tokens
- [ ] Returns the OTP `identifier` to the frontend — never the raw OTP, never tokens
- [ ] Sends the OTP to the user's email via `mailServiceFactory.create('otp')` (fire-and-forget — never blocks response)
- [ ] Returns user object (id, email, name — never passwordHash)
- [ ] Status 201 on success

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Email already registered | 409 `"Email already in use"` | |
| Email format invalid | 400 `"Invalid email format"` | |
| Password < 8 chars | 400 `"Password must be at least 8 characters"` | |
| Password > 128 chars | 400 `"Password too long"` | |
| Name empty or whitespace-only | 400 `"Name is required"` | |
| Name > 100 chars | 400 `"Name too long"` | |
| DB unreachable | 503 `"Service unavailable"` (propagate AppError) | |
| Duplicate request (race condition) | Only one user created (unique index on email) | |
| OTP creation or email send fails after user row committed | Not yet specified — likely needs a `resend-otp` endpoint rather than rolling back the user; flag before implementing | |

**Implementation pseudocode:**
```
register(body):
  validate body with RegisterSchema (Zod)         // middleware handles this
  email = body.email.toLowerCase().trim()
  existing = userRepo.findByEmail(email)
  if existing → throw ConflictError("Email already in use")
  hash = bcrypt.hash(body.password, 12)
  user = userRepo.create({ email, name: body.name.trim(), passwordHash: hash })
  { identifier, otp } = otpService.create(user.id)
  mailServiceFactory.create('otp').send(user.email, { otp })  // fire-and-forget
  return ok({ identifier, user: sanitize(user) }, 201)
```

**Unit test cases:**
```typescript
describe('AuthService.register', () => {
  it('creates user with bcrypt-hashed password')
  it('creates an OTP for the new user instead of issuing tokens')
  it('returns the OTP identifier in the response, never the raw otp or a token')
  it('returns user without passwordHash field')
  it('throws ConflictError when email already exists')
  it('lowercases and trims email before storing')
  it('throws if name is empty string after trim')
  it('sends the OTP email via mailServiceFactory (fire-and-forget, does not await)')
  it('does not expose passwordHash in the returned user object')
})
```

---

### POST /auth/verify-otp
**Purpose:** Confirm the OTP issued during registration and, once verified, issue tokens.
**Auth:** None
**Rate limit:** 10 req / IP / 15 min, plus the 3-attempt lock described below

**Request body:**
```typescript
{ identifier: string; otp: string }
```

**Acceptance criteria:**
- [ ] Looks up `hashedIdentifier` in Redis by the raw `identifier` from the request
- [ ] Uses `hashedIdentifier` to find the OTP row in the DB
- [ ] Compares the given `otp` against `hashedOtp` with `bcrypt.compare`
- [ ] On match: deletes the OTP row + Redis entry, returns access + refresh tokens and user details
- [ ] On mismatch: increments the attempt counter; on the 3rd failed attempt, locks the associated email and deletes the OTP row + Redis entry
- [ ] Status 200 on success

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Identifier not found in Redis (expired/unknown) | 400 `"OTP expired or invalid, please register again"` | |
| OTP row not found for hashedIdentifier | 400 `"OTP expired or invalid, please register again"` | |
| `expiresAt` in the past | 400 `"OTP expired, please register again"` | |
| OTP mismatch, attempts < 3 | 401 `"Invalid OTP"` | |
| OTP mismatch on 3rd attempt | Email locked → 403 `"Too many failed attempts, please use a different email"` | |
| OTP already consumed (row deleted) | 400 `"OTP expired or invalid, please register again"` | |

**Implementation pseudocode:**
```
verifyOtp(body):
  validate body with VerifyOtpSchema
  entry = redis.get(`otp:${body.identifier}`)
  if !entry → throw BadRequestError("OTP expired or invalid, please register again")
  { hashedIdentifier, attempts } = JSON.parse(entry)
  otpRow = otpRepo.findByHashedIdentifier(hashedIdentifier)
  if !otpRow || otpRow.expiresAt < now() → throw BadRequestError("OTP expired, please register again")
  match = await bcrypt.compare(body.otp, otpRow.hashedOtp)
  if !match:
    attempts += 1
    if attempts >= 3:
      userRepo.lockEmail(otpRow.userId)          // e.g. users.status = 'locked'
      redis.del(`otp:${body.identifier}`)
      otpRepo.delete(otpRow.id)
      throw ForbiddenError("Too many failed attempts, please use a different email")
    redis.set(`otp:${body.identifier}`, JSON.stringify({ hashedIdentifier, attempts }), { EX: remainingTtl(otpRow.expiresAt) })
    throw UnauthorizedError("Invalid OTP")
  redis.del(`otp:${body.identifier}`)
  otpRepo.delete(otpRow.id)
  user = userRepo.findById(otpRow.userId)
  accessToken = signJwt({ sub: user.id }, '15m')
  refreshToken = signJwt({ sub: user.id }, '7d')
  refreshTokenRepo.create({ userId: user.id, token: refreshToken })
  return ok({ token: accessToken, refreshToken, user: sanitize(user) })
```

**Unit test cases:**
```typescript
describe('AuthService.verifyOtp', () => {
  it('returns access and refresh tokens on correct OTP')
  it('deletes the OTP row and Redis entry after successful verification')
  it('throws BadRequestError when identifier is not found in Redis')
  it('throws BadRequestError when the OTP row has already expired')
  it('throws UnauthorizedError and increments attempts on wrong OTP')
  it('locks the user email after the 3rd failed attempt')
  it('throws ForbiddenError once the email is locked, even with the correct OTP')
})
```

---

### POST /auth/login
**Purpose:** Authenticate a user and return tokens.
**Auth:** None
**Rate limit:** 10 req / IP / 15 min

**Request body:**
```typescript
{ email: string; password: string }
```

**Acceptance criteria:**
- [ ] Validates credentials against `users.password_hash`
- [ ] Returns access + refresh tokens on success
- [ ] Updates `users.last_login_at`
- [ ] Status 200

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Email not found | 401 `"Invalid email or password"` (never distinguish) | |
| Password incorrect | 401 `"Invalid email or password"` | |
| Account locked (future) | 403 `"Account suspended"` | |
| Email valid format but missing | 400 from Zod | |
| Timing attack protection | Use `bcrypt.compare` even when user not found (compare against dummy hash) | |

**Implementation pseudocode:**
```
login(body):
  validate body with LoginSchema
  email = body.email.toLowerCase().trim()
  user = userRepo.findByEmail(email)
  // Always run bcrypt.compare to prevent timing attack
  dummyHash = '$2b$12$invalidhashfortimingnnn'
  hashToCompare = user?.passwordHash ?? dummyHash
  match = await bcrypt.compare(body.password, hashToCompare)
  if !user || !match → throw UnauthorizedError("Invalid email or password")
  accessToken = signJwt({ sub: user.id }, '15m')
  refreshToken = signJwt({ sub: user.id }, '7d')
  refreshTokenRepo.create({ userId: user.id, token: refreshToken })
  userRepo.updateLastLogin(user.id)
  return ok({ token: accessToken, refreshToken, user: sanitize(user) })
```

**Unit test cases:**
```typescript
describe('AuthService.login', () => {
  it('returns tokens for valid credentials')
  it('throws UnauthorizedError for wrong password')
  it('throws UnauthorizedError for unknown email (same error message as wrong password)')
  it('calls bcrypt.compare even when user is not found (timing attack prevention)')
  it('updates last_login_at on successful login')
  it('creates a new refresh token row on successful login')
  it('lowercases email before lookup')
})
```

---

### POST /auth/refresh
**Purpose:** Issue a new access token using a valid refresh token.
**Auth:** None (uses refresh token in body)

**Request body:**
```typescript
{ refreshToken: string }
```

**Acceptance criteria:**
- [ ] Validates refresh token signature and expiry
- [ ] Verifies token exists in DB (not revoked)
- [ ] Returns new access token (15 min)
- [ ] Does NOT rotate refresh token (stateless rotation not required here)

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Token signature invalid | 401 `"Invalid refresh token"` | |
| Token expired (JWT) | 401 `"Refresh token expired"` | |
| Token not found in DB (revoked/used) | 401 `"Refresh token revoked"` | |
| Token belongs to deleted user | 401 `"User not found"` | |
| Missing token in body | 400 from Zod | |

**Implementation pseudocode:**
```
refresh(body):
  validate body with RefreshSchema
  payload = verifyJwt(body.refreshToken, JWT_REFRESH_SECRET)
    on error → throw UnauthorizedError("Invalid refresh token")
  storedToken = refreshTokenRepo.findByToken(body.refreshToken)
  if !storedToken → throw UnauthorizedError("Refresh token revoked")
  user = userRepo.findById(payload.sub)
  if !user → throw UnauthorizedError("User not found")
  accessToken = signJwt({ sub: user.id }, '15m')
  return ok({ token: accessToken })
```

**Unit test cases:**
```typescript
describe('AuthService.refresh', () => {
  it('returns new access token for valid refresh token')
  it('throws for invalid JWT signature')
  it('throws for expired JWT')
  it('throws when token not found in DB (revoked)')
  it('throws when user linked to token no longer exists')
})
```

---

### POST /auth/logout
**Purpose:** Revoke a refresh token.
**Auth:** JWT access token

**Request body:**
```typescript
{ refreshToken: string }
```

**Acceptance criteria:**
- [ ] Deletes the refresh token row from DB
- [ ] Idempotent (calling again with already-deleted token returns 200, not error)
- [ ] Does not invalidate the access token (short-lived by design)

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Token already deleted | 200 (idempotent) | |
| Token not owned by current user | 403 `"Forbidden"` (check ownership) | |
| Missing refresh token | 400 from Zod | |

**Implementation pseudocode:**
```
logout(userId, body):
  validate body with LogoutSchema
  storedToken = refreshTokenRepo.findByToken(body.refreshToken)
  if storedToken && storedToken.userId !== userId
    → throw ForbiddenError("Forbidden")
  refreshTokenRepo.deleteByToken(body.refreshToken)  // no-op if not found
  return ok(null, "Logged out")
```

**Unit test cases:**
```typescript
describe('AuthService.logout', () => {
  it('deletes the refresh token on success')
  it('returns 200 when token already deleted (idempotent)')
  it('throws ForbiddenError when token belongs to different user')
})
```

---

### GET /github/oauth/url
**Purpose:** Generate the GitHub OAuth authorization URL for identity linking.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Returns a GitHub OAuth URL with `state` param (CSRF token stored in session/DB)
- [ ] Scopes requested: `read:user user:email`
- [ ] State token expires in 10 minutes

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| User already has githubId linked | Still returns URL (re-linking allowed) | |
| State param missing on callback | 400 `"Invalid state"` (enforced in callback route) | |

---

### GET /github/oauth/callback
**Purpose:** Exchange OAuth code for token, link GitHub identity to user.
**Auth:** None (CSRF-state verified)

**Query params:**
```typescript
{ code: string; state: string }
```

**Acceptance criteria:**
- [ ] Verifies `state` against stored CSRF token
- [ ] Exchanges `code` for GitHub access token
- [ ] Fetches GitHub user profile (id, login, email)
- [ ] Links `githubId` and `githubLogin` to existing user (from JWT stored in state)
- [ ] Stores encrypted GitHub access token
- [ ] Redirects to `/install` on success

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|--------|
| Invalid state | 400 `"Invalid or expired state"` | |
| GitHub API error on code exchange | 502 `"GitHub authentication failed"` | |
| GitHub account already linked to another user | 409 `"GitHub account already linked to another user"` | |
| Code already used (replay) | GitHub returns error → 400 `"Code already used"` | |

---

## Shared auth middleware (all JWT-protected routes)

**`authMiddleware` behaviour:**
```
authMiddleware(req, res, next):
  header = req.headers.authorization
  if !header or !header.startsWith('Bearer ')
    → return 401 "Missing or malformed authorization header"
  token = header.split(' ')[1]
  payload = verifyJwt(token, JWT_SECRET)
    on JsonWebTokenError → 401 "Invalid token"
    on TokenExpiredError → 401 "Token expired"
  user = userRepo.findById(payload.sub)
  if !user → 401 "User not found"
  req.user = user
  next()
```

**Unit test cases for authMiddleware:**
```typescript
describe('authMiddleware', () => {
  it('attaches req.user for valid token')
  it('returns 401 when Authorization header is missing')
  it('returns 401 when token is malformed')
  it('returns 401 when token is expired')
  it('returns 401 when user no longer exists in DB')
  it('does not call next() on any error path')
})
```

---

## Frontend: auth state (`store/auth.store.ts`)

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (token: string, refreshToken: string, user: User) => void;
  logout: () => void;
}
```

**Persistence:** `token` and `refreshToken` stored in `localStorage` (rehydrated on mount).
**Interceptor:** axios interceptor in `lib/api.ts` attaches `Authorization: Bearer <token>` on every request and attempts refresh on 401.

**Registration → OTP verification:** `POST /auth/register` no longer returns tokens, so
`login()` is not called yet. The response `identifier` is held outside `AuthState` (e.g.
component state or `sessionStorage`, not `localStorage` — it's single-use and short-lived)
while the user is routed to an OTP-entry screen. That screen submits `{ identifier, otp }`
to `POST /auth/verify-otp`; only on that call's success does the frontend call `login()`
with the returned token/refreshToken/user, same as the existing login flow.

**Frontend edge cases:**
| Case | Behaviour |
|------|-----------|
| 401 from any protected route | Interceptor calls `POST /auth/refresh`; retries once; if still 401 → `logout()` + redirect `/login` |
| Refresh token expired on page load | Redirect to `/login` with `?reason=session_expired` |
| Two tabs open, user logs out in one | Other tab detects `localStorage` change via `storage` event, clears state |
| `verify-otp` returns 403 (email locked) | Show "please register with a different email"; do not retry same identifier |
| User closes/reloads tab mid-OTP-entry | `identifier` in `sessionStorage` is lost on tab close by design — user must register again |
