'use client';

// Adapt the application's existing prop interface to the copied reference primitives.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import * as Cards from './card';
import { Button as ReferenceButton } from './button';
import { Badge as ReferenceBadge } from './badge';
import { Separator } from './separator';
import { Dialog as DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog';

export function Button({ variant = 'default', size = 'base', className, ...props }: Omit<ComponentProps<typeof ReferenceButton>, 'variant' | 'size'> & { variant?: ComponentProps<typeof ReferenceButton>['variant'] | 'primary' | 'danger'; size?: ComponentProps<typeof ReferenceButton>['size'] | 'md' }) {
  const mapped = variant === 'primary' ? 'default' : variant === 'danger' ? 'destructive' : variant;
  const mappedSize = size === 'md' ? 'base' : size;
  return <ReferenceButton variant={mapped} size={mappedSize} className={cn('ui-button', `ui-button-${mapped}`, `ui-button-${mappedSize}`, className)} {...props} />;
}
export function Card({ className, ...props }: ComponentProps<typeof Cards.Card>) { return <Cards.Card className={cn('ui-card', className)} {...props} />; }
export function CardHeader({ className, ...props }: ComponentProps<typeof Cards.CardHeader>) { return <Cards.CardHeader className={cn('ui-card-header', className)} {...props} />; }
export function CardContent({ className, ...props }: ComponentProps<typeof Cards.CardContent>) { return <Cards.CardContent className={cn('ui-card-content', className)} {...props} />; }
export function CardTitle({ className, ...props }: ComponentProps<typeof Cards.CardTitle>) { return <Cards.CardTitle className={cn('ui-card-title', className)} {...props} />; }
export function CardDescription({ className, ...props }: ComponentProps<typeof Cards.CardDescription>) { return <Cards.CardDescription className={cn('ui-card-description', className)} {...props} />; }
export function CardFooter({ className, ...props }: ComponentProps<typeof Cards.CardFooter>) { return <Cards.CardFooter className={cn('ui-card-footer', className)} {...props} />; }
export function Badge({ tone = 'neutral', className, ...props }: ComponentProps<'span'> & { tone?: 'neutral' | 'safe' | 'warning' | 'danger' }) { return <ReferenceBadge variant="secondary" className={cn('ui-badge', `ui-badge-${tone}`, className)} {...props} />; }
export function Divider({ className, ...props }: ComponentProps<typeof Separator>) { return <Separator className={cn('ui-divider', className)} {...props} />; }
export function Dialog({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return <DialogRoot open={open} onOpenChange={next => { if (!next) onClose(); }}><DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col"><DialogHeader className="shrink-0"><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : null}</DialogHeader><div className="min-h-0 overflow-y-auto">{children}</div>{footer ? <DialogFooter className="shrink-0">{footer}</DialogFooter> : null}</DialogContent></DialogRoot>;
}
