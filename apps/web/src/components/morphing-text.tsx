'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ShimmeringText } from './shimmering-text';

export function MorphingText({ text, shimmer = false }: { text: string; shimmer?: boolean }) {
  const reducedMotion = useReducedMotion();
  return <span className="morphing-text">
    <span className="sr-only">{text}</span>
    {reducedMotion ? <span className="morphing-text-content" aria-hidden="true">{text}</span> : <AnimatePresence initial={false}>
      <motion.span key={text} className="morphing-text-content" aria-hidden="true"
        initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
        exit={{ opacity:0, y:-4, transition:{ duration:0.15, ease:'easeOut' } }}
        transition={{ duration:0.22, ease:'easeOut' }}>
        {shimmer ? <ShimmeringText text={text} duration={0.65} className="morphing-text-shimmer leading-[inherit]" /> : text}
      </motion.span>
    </AnimatePresence>}
  </span>;
}
