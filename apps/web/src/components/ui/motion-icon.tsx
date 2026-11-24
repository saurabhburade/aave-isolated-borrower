'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

/** Decorative icon; its containing control supplies the accessible label. */
export function MotionIcon({ icon: Icon, state }: { icon: LucideIcon; state: string }) {
  const reducedMotion = useReducedMotion();
  return <span aria-hidden="true" className="pointer-events-none inline-grid shrink-0">
    <AnimatePresence initial={false}>
      <motion.span
        key={state}
        className="col-start-1 row-start-1 inline-grid place-items-center"
        initial={reducedMotion ? false : { opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0 }}
      ><Icon /></motion.span>
    </AnimatePresence>
  </span>;
}
