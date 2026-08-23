# Frontend Design System
> Token reference for CodeIQ. Source: Claude Design mockup `CodeIQ Dashboard.dc.html` (imported
> 2026-08-23) — confirmed the tokens below already matched `tailwind.config.ts` exactly (no
> changes needed there); the three rules and diff-line tokens after "Border radius" are new,
> carried verbatim from the mockup's own "Design notes" screen.

## Color tokens (Tailwind custom config)
```js
// tailwind.config.ts
colors: {
  bg:       '#0A0A0F',
  surface:  '#111118',
  surface2: '#18181F',
  surface3: '#1F1F28',
  accent:   '#22D3A5',  // teal — primary action
  accent2:  '#3B82F6',  // blue — secondary
  border:   'rgba(255,255,255,0.07)',
  border2:  'rgba(255,255,255,0.12)',
  text:     '#F0F0F5',
  text2:    '#9999AA',
  text3:    '#55556A',
  green:    '#34D399',
  yellow:   '#FBBF24',
  red:      '#F87171',
  blue:     '#60A5FA',
  purple:   '#A78BFA',
}
```

## Severity colors
| Severity | Color token | Tailwind class |
|----------|-------------|----------------|
| critical | red `#F87171` | `text-red bg-red/10 border-red/20` |
| warning  | yellow `#FBBF24` | `text-yellow bg-yellow/10 border-yellow/20` |
| info     | blue `#60A5FA` | `text-blue bg-blue/10 border-blue/20` |

## Category icons
| Category | Icon |
|----------|------|
| bug | 🐛 |
| security | 🔐 |
| style | ✏️ |
| performance | ⚡ |
| logic | 🧩 |

## Typography
```css
/* Display / headings */
font-family: 'Syne', sans-serif;
/* Body / UI */
font-family: 'DM Sans', sans-serif;
/* Code / monospace */
font-family: 'DM Mono', monospace;
```

## Spacing scale
Tailwind default (4px base). Use `gap-*`, `p-*`, `m-*` from Tailwind only.

## Border radius
- Cards: `rounded-xl` (12px)
- Buttons: `rounded-lg` (8px)
- Badges/tags: `rounded-full`
- Inputs: `rounded-lg`

## Cross-cutting design rules
1. **Mono for code identity.** Repo names, PR numbers, and SHAs render in `DM Mono`, not the body
   font — separates identifiers from prose for a scanning developer, at the cost of denser tables
   than a typical SaaS dashboard. Applies to: repo full names, `#482`-style PR numbers, git SHAs,
   file paths, glob patterns.
2. **Severity is colour plus a word, never colour alone.** Every severity chip/pill carries both
   its colour token and a text label (and usually a count) — a colour-only dot fails colour-blind
   readers and greyscale printing.
3. **Diff-snippet line tokens** (used by `DiffSnippet`/review-issue diff blocks):
```js
diffLine: {
  context: { bg: 'transparent',            fg: 'text2' },       // "#0D0D13" bg in the mockup, text2 fg
  added:   { bg: 'rgba(52,211,153,0.09)',  fg: '#7EE9BE' },
  removed: { bg: 'rgba(248,113,113,0.09)', fg: '#F8A0A0' },
}
```

## Component inventory (shadcn/ui primitives)
| Component | Import |
|-----------|--------|
| Button | `@/components/ui/Button` |
| Input | `@/components/ui/Input` |
| Badge | `@/components/ui/Badge` |
| Modal | `@/components/ui/Modal` |
| Tooltip | `@/components/ui/Tooltip` |
| Select | `@/components/ui/Select` |
| Skeleton | `@/components/ui/Skeleton` |

## Custom components inventory
| Component | Location | Purpose |
|-----------|----------|---------|
| SeverityBadge | `components/reviews/SeverityBadge.tsx` | critical/warning/info badge |
| CategoryBadge | `components/reviews/CategoryBadge.tsx` | bug/security/etc badge |
| ReviewCard | `components/reviews/ReviewCard.tsx` | PR review summary card |
| DiffViewer | `components/reviews/DiffViewer.tsx` | syntax-highlighted diff |
| CommentThread | `components/reviews/CommentThread.tsx` | inline comment list |
| RepoCard | `components/repos/RepoCard.tsx` | repo with active toggle |
| StatsGrid | `components/dashboard/StatsGrid.tsx` | 4-up stat cards |
| IssuesTrend | `components/dashboard/IssuesTrendChart.tsx` | recharts line chart |
| Sidebar | `components/layout/Sidebar.tsx` | dashboard nav — logo+plan badge, nav items w/ real repo/review counts, footer (installation switcher + user row, added 2026-08-23 — was missing from the initial Step 1 scaffold, see the mockup's sidebar) |
| PageHeader | `components/layout/PageHeader.tsx` | breadcrumb + h1 title + optional right-aligned action — used identically on every dashboard page (added 2026-08-23) |
| ErrorBanner | `components/ui/ErrorBanner.tsx` | page-level API error |
| LoadingSkeleton | `components/ui/LoadingSkeleton.tsx` | content placeholder |
| FileRail | `components/reviews/FileRail.tsx` | review-detail file list w/ severity tick |
| DiffSnippet | `components/reviews/DiffSnippet.tsx` | unified-diff lines (context/added/removed) |
| IssueCard | `components/reviews/IssueCard.tsx` | severity/category header + message + diff + suggestion |
| PlanCards | `components/billing/PlanCards.tsx` | 3-tier plan comparison, current-plan highlight |
| SeatsPanel | `components/billing/SeatsPanel.tsx` | GitHub org members + role + PR count |
