"use client";

import { type FC, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

interface PageTransitionProps {
  children: ReactNode;
}

// .ai/plans/frontend.md Step 9 "Framer Motion page transitions" — a short fade+rise keyed by
// pathname so navigating between dashboard screens doesn't hard-cut. Respects
// prefers-reduced-motion (via useReducedMotion) by collapsing to an instant, motion-free swap
// rather than skipping the wrapper entirely, so layout stays identical either way.
export const PageTransition: FC<PageTransitionProps> = ({ children }) => {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
        transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
};
