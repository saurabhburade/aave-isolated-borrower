# UI components

Shared UI primitives and motion extensions for the web application. shadcn defines component styles and variants, Base UI provides interaction and accessibility behavior, and Animate UI and Motion provide animation.

## Components

| Component | Purpose |
| --- | --- |
| `dialog.tsx` | Shared animated dialog for settings, asset selection, review, and management |
| `checkbox.tsx` | Animated checkbox with shared field styles |
| `tooltip.tsx` | Shared animated help and account tooltips |
| `motion-button.tsx` | Button variants with optional press feedback |
| `motion-icon.tsx` | Decorative icon transitions driven by explicit state |
| `motion-provider.tsx` | App-wide transitions and reduced-motion preferences |

## Usage

```tsx
import { Sun } from 'lucide-react';
import { MotionButton } from '@/components/ui/motion-button';
import { MotionIcon } from '@/components/ui/motion-icon';

<MotionButton variant="secondary" size="icon" aria-label="Change theme">
  <MotionIcon icon={Sun} state="light" />
</MotionButton>
```

Use `static` on `MotionButton` to disable press feedback. Controls containing decorative icons must supply an accessible label.

## Conventions

- Compose existing primitives in extension files so shadcn components remain independently updatable.
- Let the shared dialog own its positioning and animation; avoid competing transforms or CSS animations in consumers.
- Respect reduced-motion preferences through `MotionProvider` and the component primitives.
- Keep borrow review and position management on the shared confirmation shell in `../confirmation-dialog.tsx`.

The web app's `components.json` defines the shadcn style and import aliases. See the [UI provenance notes](../../../../../docs/ui-copy-audit.md) for the shared transaction components.

## Checks

With the web app running on port 3210, run from the repository root:

```sh
pnpm --filter @aave-isolated/web typecheck
pnpm --filter @aave-isolated/web exec node scripts/check-dialog.cjs
pnpm --filter @aave-isolated/web exec node scripts/check-motion.cjs
```

The browser checks exercise dialog layout, keyboard interaction, focus restoration, and motion preferences. `BROWSER_BASE_URL` overrides the app URL for the dialog check; `HEADLESS_CHROMIUM` selects an existing Chromium executable for either browser check.
