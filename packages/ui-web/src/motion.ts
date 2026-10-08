/**
 * Shared motion presets — the single source of truth for product motion.
 *
 * Aligned with `motion@14` (`motion/react`). One style only: blur in / blur out,
 * `EASE_LUXE`, tween. Zero bounce, zero spring, zero overshoot. Fast but never
 * fake: entrances read instantly, exits leave faster. See DESIGN.MD "Motion".
 *
 * Consumers:
 * - `motion/react` components (`<motion.div {...blurIn} />`, `AnimatePresence`).
 * - Base UI primitives via CSS `data-starting-style` / `data-ending-style`
 *   (same durations and easing, expressed in `shadcn.css`).
 */

import type { TargetAndTransition, Transition, Variants } from "motion/react";

/** The one easing curve. Same values as CSS `cubic-bezier(0.22, 1, 0.36, 1)`. */
export const EASE_LUXE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** The same curve as a CSS value, for the few places CSS must match motion. */
export const EASE_LUXE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Seconds, because motion speaks seconds. Mirrors DESIGN.MD "Motion". */
export const DURATION = {
  /** Hover and press: color, border, background. */
  hover: 0.15,
  /** Dropdown, popover, tooltip. */
  float: 0.2,
  /** Dialog and alert dialog. */
  dialog: 0.2,
  /** Toast enter. */
  toast: 0.25,
  /** List and section content. */
  list: 0.35,
  /** Exit, shared by every surface — always faster than the entrance. */
  exit: 0.15,
  /** Exit when a Base UI element already animates through CSS. */
  ending: 0.12,
  /** Hero entrance. */
  hero: 0.8,
  /** The macOS launch mark. */
  launch: 0.9,
} as const;

/** A luxe tween at a fixed duration. Nothing else is ever a valid transition. */
export function luxe(duration: number, delay = 0): Transition {
  return delay > 0
    ? { type: "tween", duration, delay, ease: EASE_LUXE }
    : { type: "tween", duration, ease: EASE_LUXE };
}

/** Global default for `MotionConfig`: every tween inherits luxe unless overridden. */
export const luxeTransition: Transition = { type: "tween", ease: EASE_LUXE };

/** The prop bundle spread onto a `motion` element for a blur in / blur out. */
export type BlurProps = {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
};

type BlurOptions = {
  /** Enter blur radius in px. DESIGN.MD caps it at 6. */
  enter?: number;
  /** Exit blur radius in px. DESIGN.MD caps it at 4. */
  exit?: number;
  /** Vertical drift in px on enter. DESIGN.MD caps it at 6. */
  drift?: number;
  /** Enter duration in seconds. */
  enterDuration?: number;
  /** Exit duration in seconds. */
  exitDuration?: number;
};

/**
 * The one animation. Blur + opacity, at most 6px of vertical drift, no scale
 * pop, no slide. Every surface is a different duration, never a different shape.
 */
export function blurPreset({
  enter = 6,
  exit = 4,
  drift = 6,
  enterDuration = DURATION.list,
  exitDuration = DURATION.exit,
}: BlurOptions = {}): BlurProps {
  return {
    initial: { opacity: 0, y: drift, filter: `blur(${enter}px)` },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: luxe(enterDuration),
    },
    exit: {
      opacity: 0,
      filter: `blur(${exit}px)`,
      transition: luxe(exitDuration),
    },
  };
}

/** Default: list and section content. */
export const blurIn = blurPreset();

/** Dropdown, popover, tooltip, select, command palette. */
export const blurInFloat = blurPreset({
  enterDuration: DURATION.float,
  exitDuration: DURATION.ending,
});

/** Dialog and alert dialog. */
export const blurInDialog = blurPreset({
  enterDuration: DURATION.dialog,
  exitDuration: DURATION.exit,
});

/** Toast. Enters together, leaves with no slide. */
export const blurInToast = blurPreset({
  enterDuration: DURATION.toast,
  exitDuration: DURATION.exit,
});

/** The macOS launch mark: a slower, larger blur that resolves to sharp. */
export const blurInLaunch = blurPreset({
  enter: 12,
  exit: 10,
  drift: 0,
  enterDuration: DURATION.launch,
  exitDuration: DURATION.list,
});

/** Hero entrance container: opacity drift only, staggered children. */
export const heroContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.07 } },
};

/** Hero entrance item: a deeper blur, still capped and still luxe. */
export const heroItem: Variants = {
  hidden: { opacity: 0, y: 6, filter: "blur(7px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: luxe(DURATION.hero),
  },
};

/** Toast stack variants, when driven through a variant parent. */
export const toastMotion: Variants = {
  initial: { opacity: 0, y: 6, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: luxe(DURATION.toast) },
  exit: { opacity: 0, filter: "blur(4px)", transition: luxe(DURATION.exit) },
};
