import { type FC } from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

// No logo asset exists anywhere in the repo (design-system.md's Figma link is still TBD) —
// a typographic wordmark in the documented display font is the honest placeholder until a
// real mark exists, not a fabricated image.
export const Logo: FC<LogoProps> = ({ className }) => (
  <div className={cn("flex items-center gap-2 font-display text-2xl font-bold", className)}>
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-base text-bg">
      C
    </span>
    <span className="text-text">
      Code<span className="text-accent">IQ</span>
    </span>
  </div>
);
