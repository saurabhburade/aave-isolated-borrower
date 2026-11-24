'use client';

import { Tooltip as TooltipPrimitive } from '@animate-ui/react/primitives/base-ui/tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({ className, side = 'top', sideOffset = 8, align = 'start', ...props }:
  TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props,'side' | 'sideOffset' | 'align'>) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
      <TooltipPrimitive.Popup
        data-slot="tooltip-content"
        transition={{ duration: 0.15, ease: 'easeOut' }}
        exitTransition={{ duration: 0.1, ease: 'easeOut' }}
        className={cn('max-w-[min(280px,calc(100vw-32px))] rounded-xl border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md outline-none',className)}
        {...props}
      />
    </TooltipPrimitive.Positioner>
  </TooltipPrimitive.Portal>;
}

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
