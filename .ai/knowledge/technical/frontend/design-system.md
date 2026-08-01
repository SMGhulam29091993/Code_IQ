# Frontend Design System
> Token reference for CodeIQ. Source: Figma library (link TBD).

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
| Sidebar | `components/layout/Sidebar.tsx` | dashboard nav |
| ErrorBanner | `components/ui/ErrorBanner.tsx` | page-level API error |
| LoadingSkeleton | `components/ui/LoadingSkeleton.tsx` | content placeholder |
