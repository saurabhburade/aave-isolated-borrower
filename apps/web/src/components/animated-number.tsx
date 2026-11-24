'use client';

import { useLayoutEffect } from 'react';
import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react';

function AnimatedDigit({ digit }: { digit: number }) {
  const reducedMotion = useReducedMotion();
  const value = useSpring(digit, { stiffness: 240, damping: 30, mass: 0.7 });
  const y = useTransform(value, current => `${-current * 1.25}em`);

  useLayoutEffect(() => {
    if (reducedMotion) value.jump(digit);
    else value.set(digit);
  }, [digit, reducedMotion, value]);

  return <span className="animated-number-digit" data-digit={digit}>
    <motion.span className="animated-number-strip" style={{ y }}>
      {Array.from({ length: 10 }, (_, number) => <span key={number}>{number}</span>)}
    </motion.span>
  </span>;
}

export function AnimatedNumber({ text }: { text: string }) {
  const [number = '', suffix = ''] = text.split(/(?<=[\d,.])(?=[^\d,.])/, 2);
  return <span className="animated-number" data-value={text}>
    <span className="sr-only">{text}</span>
    <span className="animated-number-display" aria-hidden="true">
      {[...number].map((character, index) => /\d/.test(character)
        ? <AnimatedDigit key={`digit-${number.length - index}`} digit={Number(character)} />
        : <span key={`separator-${number.length - index}`}>{character}</span>)}
      {suffix ? <span className="animated-number-suffix">{suffix}</span> : null}
    </span>
  </span>;
}
