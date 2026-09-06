import { type FC } from "react";
import Link from "next/link";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repos List" edge cases — shown when
// POST /repos/:id/activate returns 403 (Free tier repo limit reached).
export const PlanLimitBanner: FC = () => (
  <div className="flex items-center justify-between gap-4 rounded-card border border-yellow/20 bg-yellow/10 p-4 text-sm text-yellow">
    <span>You&apos;ve reached the Free tier&apos;s repo limit. Upgrade to activate more.</span>
    <Link href="/billing" className="font-medium underline">
      View plans
    </Link>
  </div>
);
