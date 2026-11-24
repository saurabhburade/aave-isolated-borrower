'use client';

import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';

export function InlineNotice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'error' }) {
  return <div className="execution-notice review-notice" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
    <CircleAlert aria-hidden="true" /><span>{children}</span>
  </div>;
}
