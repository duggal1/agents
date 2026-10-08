import { cn } from "@rakazo/ui-web";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import "./beautiful-ui.css";

/* Beautiful UI primitives — hand-ported from beautifului.dev
   (github.com/TurboKach/ai-native-react-components, MIT © 2026 Turbo).
   The upstream components are demo showcases; these ports keep their visual
   language (shimmer sweep, pop-in success) and expose real props. The loading
   pattern itself is the terminal loader, per DESIGN.MD. */

/**
 * A light sweep travelling across a text label. Shares the terminal loader's
 * exact color variables, so a standalone shimmer never disagrees with the
 * spinner it sits beside.
 */
export function Shimmer({ children }: { children: React.ReactNode }) {
  return <span className="term-shimmer">{children}</span>;
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * The one loading pattern: a braille spinner plus a shimmering label, driven
 * off a single CSS timeline. Pass an agent avatar color to tint the spinner;
 * omit it for neutral. The label stays neutral either way.
 */
export function TerminalLoader({
  label,
  color,
  className,
}: {
  label: string;
  /** Agent avatar color, any CSS color. Omit for neutral. */
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn("term-loader", className)}
      role="status"
      aria-live="polite"
      style={color ? ({ "--agent-color": color } as CSSProperties) : undefined}
    >
      <span className="term-spinner" aria-hidden="true">
        <span className="term-strip">
          {FRAMES.map((frame) => (
            <span key={frame}>{frame}</span>
          ))}
        </span>
      </span>
      <span className="term-label">{label}</span>
    </span>
  );
}

/** Format wall-clock seconds since `startedAtMs` as `0.0s` / `1m 2.3s`. */
export function formatElapsed(startedAtMs: number, nowMs: number): string {
  const totalTenths = Math.round(Math.max(0, nowMs - startedAtMs) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  if (minutes === 0) return `${seconds.toFixed(1)}s`;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

function useElapsed(startedAtMs?: number): string {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(startedAtMs ?? mountedAt, now);
}

/** Terminal loader with a live elapsed timer, aligned to the shimmer baseline. */
function DefaultLoadingState({ label, startedAt }: { label: string; startedAt?: number }) {
  const elapsed = useElapsed(startedAt);
  return (
    <>
      <TerminalLoader label={label} />
      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{elapsed}</span>
    </>
  );
}

export function LoadingState({
  indicator,
  label = "working",
  startedAt,
}: {
  indicator?: React.ReactNode;
  label?: string;
  /** Epoch ms when the run started. Falls back to mount time when omitted. */
  startedAt?: number;
}) {
  if (indicator) {
    return (
      <span role="status" className="flex w-fit items-center gap-2.5">
        <span className="sr-only">{label}</span>
        {indicator}
      </span>
    );
  }
  return (
    <span className="flex w-fit items-center gap-2.5">
      <DefaultLoadingState label={label} startedAt={startedAt} />
    </span>
  );
}

/** Blur-in green check with a blur-in label — the approval-card success beat. */
export function SuccessPop({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-background"
        style={{ animation: "bui-pop-in 350ms cubic-bezier(0.22,1,0.36,1) both" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      <span
        className="text-[13px] font-normal text-foreground"
        style={{ animation: "bui-fade-up 350ms cubic-bezier(0.22,1,0.36,1) 100ms both" }}
      >
        {label}
      </span>
    </span>
  );
}

/** Card shell. */
export function BuiCard({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn("rounded-2xl border border-border bg-card shadow-none", className)}
    />
  );
}
