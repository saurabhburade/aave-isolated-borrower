"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Highlight band painted across the text. The gradient is 3× the text width
 * with the band in its middle third, so at either end of the sweep the visible
 * window is solid `--color` and the band enters/leaves fully off-text.
 */
const SHIMMER_GRADIENT =
  "linear-gradient(90deg, var(--color) 0%, var(--color) 40%, var(--shimmering-color) 50%, var(--color) 60%, var(--color) 100%)";
const SHIMMER_BG_SIZE = "300% 100%";
/** Band off the right edge → band off the left edge (left-to-right sweep). */
const SWEEP_FROM = "100% 0%";
const SWEEP_TO = "0% 0%";

export type ShimmeringTextProps = Omit<
  ComponentProps<typeof motion.span>,
  "children"
> & {
  /** The text to render with the shimmering effect. */
  text: string;
  /**
   * Duration in seconds for one shimmer sweep across the text.
   * @defaultValue 1.5
   */
  duration?: number;
  /**
   * Pause the shimmer (e.g. when the hero leaves the viewport).
   * @defaultValue false
   */
  paused?: boolean;
  /**
   * Legacy alias for `paused`.
   * @defaultValue false
   */
  isStopped?: boolean;
};

export function ShimmeringText({
  text,
  duration = 1.5,
  isStopped = false,
  paused = false,
  className,
  style,
  ...props
}: ShimmeringTextProps) {
  const reducedMotion = useReducedMotion();
  const stopped = isStopped || paused || reducedMotion === true;

  // One gradient across the whole run (rather than per-character colors), so
  // the highlight is a smooth band and RTL / cursive scripts keep their glyph
  // joining and visual order.
  return (
    <motion.span
      className={cn(
        "shimmering-text inline-block select-none whitespace-nowrap leading-none",
        "[--color:var(--muted-foreground)] [--shimmering-color:var(--foreground)]",
        className
      )}
      style={{
        // CSS keeps the loop independent of an ancestor's initial={false}.
        // Otherwise a newly mounted retry can stay on the final motion frame.
        animation: stopped ? "none" : `shimmering-text-sweep ${duration * 1.4}s ease-in-out infinite`,
        backgroundPosition: stopped ? SWEEP_TO : SWEEP_FROM,
        backgroundImage: SHIMMER_GRADIENT,
        backgroundSize: SHIMMER_BG_SIZE,
        backgroundRepeat: "no-repeat",
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        ...style,
      }}
      {...props}
    >
      {text}
    </motion.span>
  );
}
