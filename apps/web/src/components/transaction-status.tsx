'use client';

import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { MorphingText } from './morphing-text';

export type TransactionStep = {
  id: string;
  title: string;
  state: 'pending' | 'active' | 'done' | 'failed' | 'unknown' | 'blocked';
  label: string;
  hash?: string;
  completedLink?: { href: string; value: string; label: string };
};

type TransactionStatusProps = { label: string; steps: readonly TransactionStep[]; error?: string; explorerUrl?: string; warning?: boolean };
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const shortHash = (value: string) => `${value.slice(0, 4)}…${value.slice(-2)}`;

// SVG Spinners: 90-ring-with-bg (https://www.shadcn.io/icon/svg-spinners-90-ring-with-bg).
function TransactionSpinner() {
  return <svg className="execution-spinner" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12,1A11,11,0,1,0,23,12,11,11,0,0,0,12,1Zm0,19a8,8,0,1,1,8-8A8,8,0,0,1,12,20Z" opacity=".25" />
    <path d="M10.14,1.16a11,11,0,0,0-9,8.92A1.59,1.59,0,0,0,2.46,12,1.52,1.52,0,0,0,4.11,10.7a8,8,0,0,1,6.66-6.61A1.42,1.42,0,0,0,12,2.69h0A1.57,1.57,0,0,0,10.14,1.16Z" />
  </svg>;
}

export function TransactionStatus({ label, steps, error, explorerUrl, warning = false }: TransactionStatusProps) {
  const reducedMotion = useReducedMotion();
  const statusUnknown = warning || steps.some((step) => step.state === 'unknown');
  return <section className="execution-progress" aria-live="polite" aria-atomic="true" aria-label={label}>
    <ol className="execution-progress-list">
      {steps.map((step) => {
        const icon = step.state === 'done' ? 'check' : step.state === 'failed' ? 'error' : step.state === 'unknown' || step.state === 'blocked' ? 'alert' : 'spinner';
        const iconGraphic = icon === 'check' ? <CircleCheck /> : icon === 'error' ? <CircleX /> : icon === 'alert' ? <CircleAlert /> : <TransactionSpinner />;
        return <li key={step.id} data-state={step.state} data-step-id={step.id}>
        <span className="execution-step-icon" aria-hidden="true">{reducedMotion ? <span>{iconGraphic}</span> : <AnimatePresence initial={false}><motion.span key={icon}
          initial={{ opacity:0, scale:0.25, filter:'blur(4px)' }}
          animate={{ opacity:1, scale:1, filter:'blur(0px)' }}
          exit={{ opacity:0, scale:0.25, filter:'blur(4px)' }}
          transition={{ type:'spring', duration:0.3, bounce:0 }}>
          {iconGraphic}
        </motion.span></AnimatePresence>}</span>
        <span className="execution-step-name"><MorphingText text={step.title} shimmer={step.state === 'active'} /></span>
        {step.completedLink ? <Link className="execution-account-link" href={step.completedLink.href} prefetch={false} target="_blank" rel="noopener noreferrer" title={step.completedLink.value} aria-label={step.completedLink.label}>{short(step.completedLink.value)}</Link> : <strong>{step.hash ? explorerUrl ? <a className="execution-step-hash" href={`${explorerUrl.replace(/\/$/, '')}/tx/${step.hash}`} target="_blank" rel="noopener noreferrer" title={`Transaction ${step.hash}`} aria-label={`View ${step.title} transaction ${step.hash} in explorer`}>{shortHash(step.hash)}</a> : <span className="execution-step-hash" title={`Transaction ${step.hash}`}>{shortHash(step.hash)}</span> : null}<MorphingText text={step.label} shimmer={step.state === 'active'} /></strong>}
      </li>;
      })}
    </ol>
    <AnimatePresence initial={false}>{error ? <motion.div className="execution-notice" data-tone={statusUnknown ? 'warning' : 'error'} role={statusUnknown ? 'status' : 'alert'}
      initial={reducedMotion ? false : { opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={reducedMotion ? undefined : { opacity:0, y:-4 }}
      transition={reducedMotion ? { duration:0 } : { duration:0.2, ease:'easeOut' }}><CircleAlert aria-hidden="true" /><span>{error}</span></motion.div> : null}</AnimatePresence>
  </section>;
}
