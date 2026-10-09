import type { ColorTokens } from "@sapphire/ui-tokens";

/**
 * Sapphire mobile design system — single source of truth.
 *
 * Combines DESIGN.MD (quiet editorial dark system: neutral-only surfaces,
 * one inverted CTA, font-normal everywhere, blur in/out, no bounce/spring)
 * with the Appllama native laws (semantic colors, continuous corners, 4/8pt
 * rhythm, 44pt targets, native controls) and the liquid-glass chatUI
 * principles (native glass ancestors stay visible, floating composer,
 * press-in feedback, keyboard-following layout).
 *
 * Rules enforced here:
 * - One accent (tokens.primary, inverted). Neutrals carry the app.
 * - One grey family (shared ui-tokens ramp). No new hexes at call sites.
 * - One corner scale, always continuous (squircle) on iOS.
 * - 4pt base unit, gap over margins, content padding in containers.
 * - Type is hierarchy + color, never weight (all 400).
 * - Narrative motion is tween EASE_LUXE; gesture motion is velocity-seeded
 *   spring. Reduce Motion collapses spatial motion to fades.
 */

export const SPACING = {
  unit: 4,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const RADII = {
  /** Small chips, badges, tags. */
  sm: 6,
  /** Inputs, mention rows, attachment pills. */
  md: 12,
  /** Cards, message bubbles, sheets content. */
  lg: 16,
  /** Composer, large cards. */
  xl: 20,
  /** Floating composer (Astra/Fable GlassContainer). */
  composer: 28,
  pill: 999,
} as const;

export const HIT_SLOP = 44;

export const EASE_LUXE_BEZIER: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_LUXE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Appllama narrative ease for Reanimated timings (strong ease-out). */
export const EASE_NATIVE: [number, number, number, number] = [0.23, 1, 0.32, 1];

export const DURATION = {
  press: 0.12,
  float: 0.2,
  dialog: 0.2,
  toast: 0.25,
  list: 0.35,
  exit: 0.15,
  hero: 0.8,
} as const;

/** One spring vocabulary for gesture-driven motion (Appllama motion law). */
export const SPRING = {
  snap: { duration: 400, dampingRatio: 1 },
  soft: { duration: 480, dampingRatio: 0.82 },
} as const;

export const TYPE = {
  largeTitle: { fontSize: 34, lineHeight: 40, fontWeight: "400" as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "400" as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "400" as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "400" as const },
  callout: { fontSize: 14, lineHeight: 19, fontWeight: "400" as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  captionSm: { fontSize: 11, lineHeight: 14, fontWeight: "400" as const },
} as const;

export type BadgeVariant =
  | "neutral"
  | "sky"
  | "blue"
  | "violet"
  | "purple"
  | "green"
  | "yellow"
  | "orange"
  | "rose";

const BADGE_BG: Record<BadgeVariant, string> = {
  neutral: "rgba(163,163,163,0.12)",
  sky: "rgba(56,189,248,0.12)",
  blue: "rgba(96,165,250,0.12)",
  violet: "rgba(167,139,250,0.12)",
  purple: "rgba(192,132,252,0.12)",
  green: "rgba(74,222,128,0.12)",
  yellow: "rgba(250,204,21,0.12)",
  orange: "rgba(251,146,60,0.12)",
  rose: "rgba(251,113,133,0.12)",
};

const BADGE_FG: Record<BadgeVariant, string> = {
  neutral: "#D4D4D4",
  sky: "#7DD3FC",
  blue: "#93C5FD",
  violet: "#C4B5FD",
  purple: "#D8B4FE",
  green: "#86EFAC",
  yellow: "#FDE047",
  orange: "#FDBA74",
  rose: "#FDA4AF",
};

export function badgeColors(variant: BadgeVariant = "neutral"): {
  backgroundColor: string;
  color: string;
} {
  return { backgroundColor: BADGE_BG[variant], color: BADGE_FG[variant] };
}

/** Semantic status -> badge variant. Accent only carries meaning. */
export function statusBadgeVariant(status: string | undefined): BadgeVariant {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (["connected", "active", "live", "verified", "completed", "finished"].includes(s))
    return "green";
  if (["pending", "syncing", "paused", "running", "trial", "queued", "leased"].includes(s))
    return "yellow";
  if (["failed", "rejected", "revoked", "deleted", "cancelled"].includes(s)) return "rose";
  if (["error", "expired", "attention", "waiting_input", "waiting_takeover"].includes(s))
    return "orange";
  return "neutral";
}

export function hairlineColor(tokens: ColorTokens): string {
  return tokens.border;
}

/**
 * Depth without decoration. Cards and toasts are never shadowed;
 * only floating glass (composer, jump-to-latest) carries one
 * elevation shadow via CSS boxShadow (RN 0.86+, no legacy shadow props).
 */
export const ELEVATION = {
  none: [] as never[],
  float: [
    {
      offsetX: 0,
      offsetY: 8,
      blurRadius: 24,
      spreadDistance: -8,
      color: "rgba(0,0,0,0.45)",
    },
  ],
} as const;
