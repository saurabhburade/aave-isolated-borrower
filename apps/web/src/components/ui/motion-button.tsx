'use client';

import type { ComponentProps } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Button } from './button';

const AnimatedButton = motion.create(Button);

export type MotionButtonProps = ComponentProps<typeof AnimatedButton> & { static?: boolean };

/** The shadcn Button API and semantics, with optional Motion press feedback. */
export function MotionButton({ static: isStatic = false, disabled, className, whileTap, transition, ...props }: MotionButtonProps) {
  const reducedMotion = useReducedMotion();
  const animate = !isStatic && !reducedMotion;
  return <AnimatedButton
    {...props}
    initial={false}
    disabled={disabled}
    className={cn('active:scale-100', className)}
    whileTap={animate && !disabled ? whileTap ?? { scale: 0.96 } : undefined}
    transition={animate ? transition ?? { type: 'spring', duration: 0.2, bounce: 0 } : { duration: 0 }}
  />;
}
