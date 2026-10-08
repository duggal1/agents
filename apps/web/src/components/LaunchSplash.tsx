import { blurInLaunch, DURATION, luxe } from "@sapphire/ui-web";
import StartMark from "@sapphire/ui-web/components/start";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";

/** How long the mark holds before it blurs out. */
const HOLD_MS = 2_600;

/**
 * Composed once per renderer load, before React mounts. The macOS shell is the
 * only surface that shows the mark, and only on launch: a warm window reopen is
 * not a launch, and neither is a route change.
 */
const showLaunchSplash = (() => {
  if (typeof window === "undefined") return false;
  return desktopBridge()?.platform === "darwin" && process.env.NODE_ENV !== "test";
})();

/**
 * The macOS launch mark: the Sapphire logo rendered as liquid metal, centered
 * and a touch oversized, blurring in once and blurring out. Skipped entirely off
 * the desktop shell and under reduced motion.
 */
export function LaunchSplash() {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(showLaunchSplash && !reducedMotion);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!showLaunchSplash || reducedMotion) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="launch-splash"
          data-rakazo-launch-splash=""
          className="fixed inset-0 z-100 grid place-items-center bg-background"
          exit={{
            opacity: 0,
            filter: "blur(6px)",
            transition: luxe(DURATION.exit),
          }}
        >
          <motion.div {...blurInLaunch} className="w-[min(46vmin,340px)]" aria-hidden="true">
            <StartMark />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
