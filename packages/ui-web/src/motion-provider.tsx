"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { luxeTransition } from "./motion.js";

/**
 * One place sets the product's motion defaults: every tween is luxe, and
 * "reduce motion" follows the OS. Nothing should need to repeat the easing.
 */
export function LuxeMotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={luxeTransition}>
      {children}
    </MotionConfig>
  );
}
