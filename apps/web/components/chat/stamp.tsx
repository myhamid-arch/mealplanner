"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** The short "stamp" that plays when a proposal is accepted (UX-5 motion; none when reduced). */
export function Stamp({ children }: { readonly children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce === true) return <span className="inline-flex">{children}</span>;
  return (
    <motion.span
      className="inline-flex"
      initial={{ scale: 1.6, rotate: -8, opacity: 0 }}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 18 }}
    >
      {children}
    </motion.span>
  );
}
