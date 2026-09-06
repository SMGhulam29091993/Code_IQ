# Screens: Onboarding `/onboarding`
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/github-app.md`, `knowledge/domains/repos.md`
> Source: Claude Design mockup `CodeIQ Dashboard.dc.html` (imported 2026-08-23) — first doc for
> this screen; it did not exist before (`plans/frontend.md`'s original Step 3 called this the
> "Install flow" and only sketched a bare CTA + OAuth callback, not a full three-step screen).
> This doc supersedes that sketch.

---

## Screen: Onboarding `/onboarding`

Shown to a user with no active GitHub App installation, or reachable any time from the sidebar to
add more repos. Copy below is quoted verbatim from the mockup — it's real product copy, not
placeholder text.

Intro copy: *"CodeIQ reviews pull requests through a GitHub App installation. Three steps, about
two minutes."*

### Components
```
(dashboard)/onboarding/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── OnboardingSteps.tsx     ← vertical numbered step list, owns which step is "current"
    ├── InstallStep.tsx         ← step 1
    ├── ChooseReposStep.tsx     ← step 2 — repo checklist + activate CTA
    └── OpenPrStep.tsx          ← step 3 — informational only, no CTA
```

Header: breadcrumb "setup", title "Connect CodeIQ to GitHub", no header CTA.

### Acceptance criteria
- [ ] **Step 1 — Install the GitHub App:** body *"CodeIQ asks for read access to code and write
  access to pull requests. Nothing is reviewed until you pick repositories in step two."* CTA
  "Install on `{accountLogin}`" → redirects to GitHub App install URL (existing `/github/*`
  install flow). Note under CTA: "opens github.com"
- [ ] **Step 2 — Choose repositories:** body *"Start with one active repository. You can add the
  rest once you have seen how the comments read on a real pull request."* Shows a checklist of
  repos from `GET /repos?installationId=:id&isActive=false` (or the full list, client-filtered);
  clicking a row toggles selection (does not call the API yet — batched). CTA "Activate N
  repositories" (N = selected count, 0 disables the button) → calls `POST /repos/:id/activate`
  for each selected repo. Note under CTA: "changeable any time"
- [ ] **Step 3 — Open a pull request:** body *"The first review lands within a minute of the PR
  opening. Severity threshold starts at WARNING, which posts blockers and warnings but keeps
  style notes in the dashboard."* No CTA, informational only — visually de-emphasized (muted
  ring/title colour) since there's nothing to click
- [ ] Step 1 is "current" until an installation exists; step 2 is "current" once an installation
  exists but has 0 active repos; step 3 is "current" (dimmed, terminal) once ≥1 repo is active
- [ ] After activating repos in step 2, redirect to `/overview`

### Pseudocode
```
OnboardingPage:
  { data: installations } = useInstallations()
  installation = installations?.[0]
  { data: repos } = useRepos({ installationId: installation?.id })

  currentStep =
    !installation ? 1 :
    !repos?.some(r => r.isActive) ? 2 :
    3

  [selected, setSelected] = useState<string[]>([])
  activateMutation = useActivateRepo()

  handleActivateSelected():
    await Promise.all(selected.map(id => activateMutation.mutateAsync(id)))
    router.push('/overview')

  render:
    <OnboardingSteps current={currentStep}>
      <InstallStep active={currentStep === 1} accountLogin={installation?.accountLogin} />
      <ChooseReposStep
        active={currentStep === 2}
        repos={repos}
        selected={selected}
        onToggle={id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])}
        onActivate={handleActivateSelected}
      />
      <OpenPrStep active={currentStep === 3} />
    </OnboardingSteps>
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| No installation yet | Step 1 current, steps 2–3 dimmed/inert |
| Installation exists, 0 active repos | Step 2 current, "Activate N repositories" disabled until ≥1 selected |
| Installation exists, ≥1 active repo | Step 3 current (informational) — screen still reachable via sidebar to add more repos, but redirect to `/overview` is the more common path once repos are active |
| `POST /repos/:id/activate` fails for one repo in a batch | Toast error naming the failed repo; already-activated repos in the batch stay activated (partial success, not rolled back) |
| Free tier plan-limit hit mid-batch (403) | Toast: "Plan limit: upgrade to activate more repos." Remaining un-activated selections are not retried |
| User has 0 repos in their GitHub org | Step 2 empty state: "No repositories found in this installation." |

### Test cases
```typescript
describe('OnboardingPage', () => {
  it('shows step 1 as current when no installation exists')
  it('shows step 2 as current when installation exists with 0 active repos')
  it('shows step 3 as current (dimmed) once at least one repo is active')
  it('redirects to /overview after activating selected repos')
  it('shows partial-failure toast when one repo activation fails in a batch')
})

describe('ChooseReposStep', () => {
  it('toggles repo selection on row click')
  it('disables the activate CTA when nothing is selected')
  it('shows the selected count in the CTA label')
  it('shows empty state when the installation has no repos')
})
```
