'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { MotionButton as Button } from '@/components/ui/motion-button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MorphingText } from './morphing-text';

function ConfirmationStatus({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(Math.ceil(content.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return <motion.div className="review-status" initial={false}
    animate={{ height:reducedMotion ? 'auto' : height }}
    transition={reducedMotion ? { duration:0 } : { duration:0.3, ease:[0.22, 1, 0.36, 1] }}>
    <div ref={contentRef}>{children}</div>
  </motion.div>;
}

export function ConfirmationDialog({ open, title, description, busy, done, actionDisabled, onConfirm, onClose, successAction, secondaryAction, children, status }: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  done: boolean;
  actionDisabled: boolean;
  onConfirm: () => void;
  onClose: () => void;
  successAction?: { label: string; href: string };
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  children: ReactNode;
  status?: ReactNode;
}) {
  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
    <DialogContent className="review-dialog">
      <DialogHeader className="review-header">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
      </DialogHeader>
      <div className="review-scroll">{children}</div>
      {status ? <ConfirmationStatus>{status}</ConfirmationStatus> : null}
      <div className="review-footer"><div>
        <Button size="base" variant="outline" disabled={!busy && secondaryAction?.disabled} onClick={done || busy ? onClose : secondaryAction?.onClick ?? onClose}><MorphingText text={done ? 'Close' : busy ? 'Cancel' : secondaryAction?.label ?? 'Cancel'} /></Button>
        {done ? successAction ? <Button size="base" nativeButton={false} role="link" render={<Link href={successAction.href} />}><MorphingText text={successAction.label} /></Button> : null : <Button size="base" aria-busy={busy} disabled={busy || actionDisabled} onClick={onConfirm}>Confirm</Button>}
      </div></div>
    </DialogContent>
  </Dialog>;
}
