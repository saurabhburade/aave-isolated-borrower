'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ type: 'spring', duration: 0.3, bounce: 0 }}>{children}</MotionConfig>;
}
