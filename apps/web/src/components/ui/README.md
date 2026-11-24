# UI components

This folder is the design kit. shadcn components own variants and styling. Base UI owns focus behavior and accessibility. Animate UI supplies Motion-powered primitives for the shared Dialog and Checkbox; Motion extensions compose the other primitives in the same folder.

- `dialog.tsx`: the shared shadcn Dialog uses `@animate-ui/react/primitives/base-ui/dialog` for interruptible entrance/exit motion and reduced-motion support. Settings, asset selection, review, and management use this same component. Do not add CSS keyframe animations or centering transforms to its consumers.
- `checkbox.tsx`: the shadcn checkbox uses Animate UI's Base UI primitive, with the same semantic colors and field composition as other controls.
- `tooltip.tsx`: shared help and subaccount tooltips use Animate UI's Base UI primitive for a 150ms fade/scale entrance and a 100ms exit. Reduced motion removes scaling; the primitive keeps the portal mounted through dismissal and skips repeated entrances when moving between nearby tooltips. Chart panels retain their existing Motion presence animations.

- `motion-button.tsx`: `MotionButton` extends `Button`, retaining its variants, sizes, refs, and disabled state. It supplies a single 0.96 press scale. `static` disables the built-in press feedback. Default rendering has no entrance animation.
- `motion-icon.tsx`: `MotionIcon` transitions a decorative Lucide icon when its explicit state changes. Its containing control supplies the accessible label.
- `motion-provider.tsx`: `MotionProvider` applies the user's reduced-motion preference across the app, with a shared spring transition.

```tsx
import { MotionButton } from '@/components/ui/motion-button';
import { MotionIcon } from '@/components/ui/motion-icon';
import { Sun } from 'lucide-react';

<MotionButton variant="secondary" size="icon" aria-label="Change theme">
  <MotionIcon icon={Sun} state="light" />
</MotionButton>

<MotionButton disabled>Unavailable</MotionButton>
<MotionButton static>Static action</MotionButton>
```

Keep the shadcn files independently updatable. Add motion behavior by composing an existing primitive in an extension file. The web app's `components.json` points the shadcn CLI here and preserves the current Base Rhea style and aliases.

Run `BROWSER_BASE_URL=http://127.0.0.1:3211 node scripts/check-dialog.cjs` against a running preview (defaults to port 3210). It checks settings centering, viewport fit, setting changes, close controls, keyboard activation, and focus restoration at desktop, tablet, and mobile widths, with normal and reduced motion. Set `HEADLESS_CHROMIUM` if using an existing browser executable.

References: [shadcn Button](https://ui.shadcn.com/docs/components/base/button), [Motion custom components](https://motion.dev/docs/react-motion-component#custom-components), and [MotionConfig](https://motion.dev/docs/react-motion-config).

## Verification

The shadcn CLI identifies Base Rhea, Base UI, Tailwind v4, and `@/components/ui` correctly. Web type checking/build and the 28 workspace tests pass. The wallet/browser suite passes with zero page errors.

Run `pnpm --filter @aave-isolated/web exec node scripts/check-motion.cjs` against the running app, with optional `HEADLESS_CHROMIUM` for an existing executable. It verifies one 0.96 press scale in normal mode, a 1.00 scale under reduced motion, retained shadcn variants/sizes, pointer and keyboard activation, and settled icon state.

## Reference transaction UI

`../confirmation-dialog.tsx`, `../transaction-status.tsx`, `../morphing-text.tsx`, and `../motion-action-tabs.tsx` copy the borrow aggregator's confirmation and status patterns. `../aave-transaction-status.tsx` maps the existing Aave execution phases to the copied status row. `../inline-notice.tsx` shares its warning/error appearance with quote and portfolio feedback. Both borrow review and position management use the same confirmation shell.

The detailed body scrolls while status and footer remain visible. Reduced motion disables shimmer, spinner rotation, and icon/text transitions. Pending native state offers Close/View positions without offering another submission. Management success stays visible until dismissed. Aave's seven management actions use the reference tabs in a horizontally scrollable container. See `docs/ui-copy-audit.md` at the repository root for scope and verification.
