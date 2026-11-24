'use client';

import { useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';

export function MotionActionTabs<T extends string>({ value, options, onChange, disabled = false }: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const indicatorId = useId();
  const reducedMotion = useReducedMotion();
  return <div className="position-manage-actions" role="tablist" aria-label="Position action">
    {options.map((option) => <button
      key={option.value}
      type="button"
      role="tab"
      id={`position-manage-tab-${option.value}`}
      aria-controls="position-manage-panel"
      aria-selected={option.value === value}
      tabIndex={option.value === value ? 0 : -1}
      disabled={disabled}
      onClick={() => onChange(option.value)}
      onKeyDown={(event) => {
        if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (selectedIndex + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        onChange(options[next].value);
        const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[next]?.focus();
      }}
    >
      {option.value === value ? <motion.span className="position-manage-tab-indicator" layoutId={indicatorId} initial={false} transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.2, 0, 0, 1] }} aria-hidden="true" /> : null}
      <span>{option.label}</span>
    </button>)}
  </div>;
}
