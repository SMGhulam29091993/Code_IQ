# Blockers
> Nothing hard-blocking. Below are product open-questions the Claude Design mockup
> (`CodeIQ Dashboard.dc.html`, imported 2026-08-23) raised itself and that got a pragmatic
> engineering default rather than a product decision — flagged here in case product wants to
> revisit. None of these block Step 3–7 of `plans/frontend.md`.

1. **Repo Detail "Insights" tab** — mockup shows 3 metrics (issues/PR, most-flagged path, fix
   rate); the latter two have no real data source. Default taken: ship only the derivable metric
   (issues/PR) plus the existing severity/category breakdown; drop the other two rather than
   fabricate them. See `knowledge/screens/dashboard-screens.md` ("Insights tab" note).
2. **Issue "Dismiss" button** — mockup shows it on every review issue card; `ReviewIssue` has no
   state for it. Default taken: render inert (no API call), no schema change. See
   `knowledge/domains/review.md`'s "no dismiss/resolution state" note.
3. **Where billing "seats" come from** — mockup shows GitHub-org-invited logins. Default taken:
   GitHub org membership (via the installation's Octokit) is the source of truth, not a
   locally-invited list — nothing in the schema models a separate invite concept. See
   `knowledge/domains/billing.md`'s `GET /billing/seats`.
