# Screens: Account `/account`
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/auth.md` (Profile tab), `knowledge/domains/github-app.md`
> (Workspace tab)
> New 2026-08-23 — not part of the Claude Design mockup (`CodeIQ Dashboard.dc.html` has no
> account/settings screen at all). Added per explicit user request for "account management",
> covering both meanings raised: the user's personal profile (new backend + new doc, nothing
> existed) and the workspace/installation settings (already spec'd in `billing-screens.md`
> as `/workspace`, backend already existed, just never built). Both now live under one
> `/account` route as two tabs, rather than two separate top-level sidebar entries — the same
> tabbed-page pattern already used for Repo Detail (`dashboard-screens.md`).

---

## Screen: Account `/account`

### Components
```
(dashboard)/account/
├── page.tsx                    ← reads ?tab=, defaults to "profile"
├── loading.tsx
├── error.tsx
└── _components/
    ├── AccountTabs.tsx          ← owns active tab, renders one of the below
    ├── ProfileForm.tsx          ← name (editable), email (read-only), member-since
    ├── ChangePasswordForm.tsx   ← hidden entirely for GitHub-only accounts
    ├── WorkspacePanel.tsx       ← installation login, plan tier + seat count (read-only)
    └── DangerZone.tsx           ← remove installation, confirm modal
```

Header: breadcrumb "account", title "Account", no header CTA.

### Acceptance criteria — tabs shell
- [ ] 2 tabs: Profile / Workspace. Default: Profile
- [ ] Tab selection reflected in URL (`?tab=workspace`), same convention as Repo Detail

### Acceptance criteria — Profile tab (`ProfileForm` + `ChangePasswordForm`)
- [ ] Loads current user via `GET /auth/me`
- [ ] Shows email as read-only text (not an input) — **not editable**, see
  `knowledge/domains/auth.md`'s `PATCH /auth/me` note on why (identity/re-verification gap)
- [ ] Name is an editable field; "Save" calls `PATCH /auth/me` with only the name (matches the
  repo-config panel's pattern of PATCH-with-diff, but this form only has the one field so there's
  nothing to diff)
- [ ] Shows "Member since `<date>`" (from `user.createdAt`)
- [ ] `ChangePasswordForm` (current password / new password / confirm new password) is shown
  only when `user.githubId` is null (i.e. the account has a real password) — a GitHub-only
  account never sees this form, matching the backend's own rejection of the endpoint for that
  case
- [ ] Change-password success clears the form and shows a success toast; does **not** log the
  user out or affect other sessions (see the domain doc's note — not designed yet)

### Acceptance criteria — Workspace tab (`WorkspacePanel` + `DangerZone`)
- [ ] Shows installation account login (read-only, from `GET /github/installations`'s first
  active installation — this app is single-installation-per-user in practice, see
  `knowledge/domains/billing.md`'s "installation as one-per-user" note)
- [ ] Shows plan tier + seat count (same fields already shown on the Billing screen)
- [ ] "Remove installation" button (in `DangerZone`) → confirm modal ("This will deactivate all
  repos. Are you sure?") → `DELETE /github/installations/:id`
- [ ] On delete success → redirect to `/onboarding` (the real "no installation" entry point —
  `billing-screens.md`'s original spec said `/install`, which was this project's placeholder
  name before Onboarding was built; there is no `/install` route) + clear
  `activeInstallationId` from `store/installation.store.ts`
- [ ] No installation at all → tab shows "No GitHub installation connected" + CTA to `/onboarding`
  instead of the panel/danger zone

### Pseudocode
```
AccountPage:
  tab = searchParams.get('tab') ?? 'profile'

  render:
    <AccountTabs active={tab} onChange={t => router.push(`?tab=${t}`)} />
    {tab === 'profile' && <ProfileTab />}
    {tab === 'workspace' && <WorkspaceTab />}

ProfileTab:
  { data: user } = useMe()                     // GET /auth/me
  updateMutation = useUpdateProfile()           // PATCH /auth/me
  passwordMutation = useChangePassword()        // POST /auth/change-password

  render:
    <ProfileForm user={user} onSave={name => updateMutation.mutate({ name })} />
    {!user.githubId && <ChangePasswordForm onSubmit={passwordMutation.mutate} />}

WorkspaceTab:
  { data: installations } = useInstallations()
  installation = installations?.[0]
  deleteMutation = useDeleteInstallation()

  if !installation → <NoInstallationState />
  render:
    <WorkspacePanel installation={installation} />
    <DangerZone onConfirmDelete={() => deleteMutation.mutate(installation.id, {
      onSuccess: () => { clearActiveInstallation(); router.push('/onboarding') }
    })} />
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| GitHub-only account (no password) | `ChangePasswordForm` not rendered at all |
| Change password: wrong current password | 401 → inline field error "Current password is incorrect" |
| Update name: empty after trim | Zod error "Name is required" |
| No installation connected | Workspace tab shows connect-GitHub empty state, not the danger zone |
| Delete installation confirm modal dismissed | No API call, modal closes |
| Delete installation fails (403) | Toast: "You don't have permission to remove this installation." |
| Delete installation succeeds | Redirect to `/onboarding` + `activeInstallationId` cleared |

### Test cases
```typescript
describe('AccountPage', () => {
  it('defaults to the Profile tab')
  it('switches tabs and reflects the choice in the URL')
})

describe('ProfileForm', () => {
  it('pre-fills the form with the current user\'s name')
  it('shows email as read-only')
  it('calls PATCH /auth/me with the updated name on save')
  it('shows a validation error when name is cleared')
})

describe('ChangePasswordForm', () => {
  it('is not rendered for a GitHub-only account (user.githubId set)')
  it('is rendered for a password account (user.githubId null)')
  it('calls POST /auth/change-password with current and new password')
  it('shows an inline error when current password is incorrect')
  it('clears the form on success')
})

describe('WorkspacePanel / DangerZone', () => {
  it('renders installation account login')
  it('renders plan tier and seat count')
  it('shows a connect-GitHub empty state when no installation exists')
  it('shows confirm modal before deletion')
  it('calls DELETE /github/installations/:id after confirmation')
  it('redirects to /onboarding on successful deletion')
  it('clears activeInstallationId from store on deletion')
  it('does not call the API when the confirm modal is dismissed')
  it('shows an error toast on 403')
})
```
