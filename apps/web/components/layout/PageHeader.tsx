import { type FC, type ReactNode } from "react";

interface PageHeaderProps {
  crumb: string;
  title: string;
  action?: ReactNode;
}

// Matches the mockup's header shell (breadcrumb above an h1, optional right-aligned action) —
// used identically on every dashboard page, so it's a shared component rather than repeating
// the same markup six times. .ai/knowledge/screens/dashboard-screens.md and friends.
export const PageHeader: FC<PageHeaderProps> = ({ crumb, title, action }) => (
  <div className="mb-6 flex items-end justify-between gap-6">
    <div>
      <p className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-text3">{crumb}</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text">{title}</h1>
    </div>
    {action && <div className="flex flex-none items-center gap-2.5">{action}</div>}
  </div>
);
