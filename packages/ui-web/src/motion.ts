/**
 * Shared motion presets — the single source of truth for product motion.
 *
 * One style only: blur in / blur out, `EASE_LUXE`, tween. Zero bounce, zero
 * spring, zero overshoot. Fast but never fake: entrances read instantly,
 * exits leave faster. See DESIGN.MD "Motion".
 *
 * Two consumers read these values:
 * - `motion/react` components (variants below, `AnimatePresence` for exits).
 * - Base UI primitives via CSS `data-starting-style` / `data-ending-style`
 *   (same durations and easing, expressed in `shadcn.css`).
 */

export const EASE_LUXE = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  hover: 0.15,
  float: 0.2,
  dialog: 0.2,
  toast: 0.25,
  list: 0.35,
  exit: 0.15,
  ending: 0.12,
  hero: 0.8,
} as const;

function luxe(duration: number) {
  return { type: "tween" as const, duration, ease: EASE_LUXE };
}

/** Default blur in / blur out for toasts, dialogs, popovers, cards, loader. */
export const blurIn = {
  initial: { opacity: 0, y: 6, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: luxe(DURATION.list) },
  exit: { opacity: 0, filter: "blur(4px)", transition: luxe(DURATION.exit) },
};

/** Hero entrance: opacity drift with stagger, blur capped so it never smears. */
export const heroContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15, delayChildren: 0.07 } },
};

export const heroItem = {
  hidden: { opacity: 0, y: 6, filter: "blur(7px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: luxe(DURATION.hero) },
};

/** Toast stack: enter together, leave fast with no slide-out. */
export const toastMotion = {
  initial: { opacity: 0, y: 6, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: luxe(DURATION.toast) },
  exit: { opacity: 0, filter: "blur(4px)", transition: luxe(DURATION.exit) },
};

/** Global default for `MotionConfig`: every tween inherits luxe unless overridden. */
export const luxeTransition = { type: "tween" as const, ease: EASE_LUXE };
