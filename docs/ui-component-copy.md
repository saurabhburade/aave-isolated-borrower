# Reference component copy

The source is the current working `onchain-borrow-aggregator/apps/web` directory. It remained read-only, including its existing uncommitted edits.

The interface now uses the reference's actual component source and current stylesheet: the wide market/chart column is on the left, the 400px borrow widget and compact 2×2 position preview are on the right, and the original header, amount fields, token picker, tables, controls, and chart interactions are retained. The oversized introduction and alternate composer layout were removed.

Only product bindings were adapted: native reserve catalogs instead of the reference's fixed token choices, one selected Aave Pool/Spoke instead of allocation routing, immutable account preview, and existing owner-bound execution/review. Historical rates come from the official Aave indexed USDC sources; V4 history is its base rate and account premium remains separate.

Compatibility adapters in `src/components/ui/compat.tsx` translate the existing management/review props into the copied primitives. Shared primitive files themselves are unmodified. The chart implementation's original license notices are preserved.

The copied chart dependencies were checked against current npm metadata, pnpm supply-chain policy checks, and a local audit. Sonatype was unavailable. The audit still reports the same transitive uuid and Zod advisories documented in `verification.md`; it added no new advisory.

The following files match the reference byte for byte (SHA-256-equivalent contents):

- `ui/card.tsx`
- `ui/input-group.tsx`
- `ui/field.tsx`
- `ui/label.tsx`
- `ui/accordion.tsx`
- `ui/tooltip.tsx`
- `ui/alert.tsx`
- `ui/toggle-group.tsx`
- `ui/dialog.tsx`
- `ui/badge.tsx`
- `ui/table.tsx`
- `ui/separator.tsx`
- `ui/button.tsx`
- `ui/toggle.tsx`
- `ui/info-tip.tsx`
- `ui/dropdown-menu.tsx`
- `ui/textarea.tsx`
- `ui/input.tsx`
- `ui/skeleton.tsx`
- `charts/visx-pattern.tsx`
- `charts/chart-context.tsx`
- `charts/decimate-time-series.ts`
- `charts/indicator-fade.ts`
- `charts/LICENSE-bklit`
- `charts/band.tsx`
- `charts/path-stroke-utils.ts`
- `charts/projection-line.tsx`
- `charts/responsive-chart-label-count.ts`
- `charts/line-loading-pulse.tsx`
- `charts/y-axis-scales.ts`
- `charts/motion-utils.ts`
- `charts/bollinger.ts`
- `charts/use-scheduled-tooltip.ts`
- `charts/use-animated-series-path.ts`
- `charts/use-mount-progress.ts`
- `charts/filter-data-by-x-domain.ts`
- `charts/series-hover-dim.tsx`
- `charts/series-path-utils.ts`
- `charts/generate-chart-skeleton-data.ts`
- `charts/use-grid-shimmer.ts`
- `charts/pattern-preset.tsx`
- `charts/use-chart-phase-orchestrator.ts`
- `charts/background.tsx`
- `charts/area-gradient-defs.tsx`
- `charts/grid.tsx`
- `charts/band-config.ts`
- `charts/series-bar-layout.ts`
- `charts/chart-phase.ts`
- `charts/chart-child-passthrough.ts`
- `charts/use-highlight-segment.ts`
- `charts/projection-config.ts`
- `charts/series-point-marker.tsx`
- `charts/animation.ts`
- `charts/chart-legend-hover.tsx`
- `charts/use-animated-band.ts`
- `charts/chart-reveal-clip.tsx`
- `charts/use-animated-y-domains.ts`
- `charts/loading-sweep.tsx`
- `charts/projection-line-end-marker.tsx`
- `charts/chart-parent-size.tsx`
- `charts/static-chart-preview-context.tsx`
- `charts/chart-config-context.tsx`
- `charts/line-chart.tsx`
- `charts/projection-utils.ts`
- `charts/y-axis-ticks.ts`
- `charts/line-backdrop.tsx`
- `charts/use-chart-interaction.ts`
- `charts/use-enter-complete.ts`
- `charts/series-dash-tail-overlay.tsx`
- `charts/dash-tail-stroke.tsx`
- `charts/highlight-segment.tsx`
- `charts/highlight-segment-bounds.ts`
- `charts/chart-loading-label.tsx`
- `charts/band-geometry.ts`
- `charts/line-loading-timing.ts`
- `charts/chart-defs.ts`
- `charts/time-series-chart-shell.tsx`
- `charts/reference-area-config.ts`
- `charts/series-highlight-layer.tsx`
- `charts/chart-formatters.ts`
- `charts/fade-edges.ts`
- `charts/reference-area-registration-context.tsx`
- `charts/line-series-terminal-marker.tsx`
- `charts/line.tsx`
- `charts/series-markers.tsx`
- `charts/x-axis.tsx`
- `charts/y-domain-utils.ts`
- `charts/line-chart-loading.tsx`
- `charts/tooltip/tooltip-box.tsx`
- `charts/tooltip/cursor-tooltip-box.tsx`
- `charts/tooltip/tooltip-dot.tsx`
- `charts/tooltip/tooltip-indicator.tsx`
- `charts/tooltip/use-delayed-tooltip-data.ts`
- `charts/tooltip/chart-tooltip.tsx`
- `charts/tooltip/tooltip-content.tsx`
- `charts/tooltip/index.ts`
- `charts/tooltip/date-ticker.tsx`
- `charts/patterns/LICENSE-visx-pattern`
- `charts/patterns/lines.tsx`
- `charts/patterns/path.tsx`
- `charts/patterns/circles.tsx`
- `charts/patterns/pattern.tsx`
- `charts/patterns/waves.tsx`
- `charts/patterns/hexagons.tsx`
- `charts/patterns/constants.ts`
- `charts/patterns/index.ts`

## Integrated review

Full scope: borrow workspace and shared components, Next.js/React, existing CSS/Tailwind 4 styling. Native contracts and transaction authority were unchanged.

| Category | Evidence | Result |
| --- | --- | --- |
| Typography | Current reference stylesheet, copied field/card/button source, desktop/mobile screenshots | Reference type scale restored; oversized introduction removed |
| Surfaces | Original card/input-group/picker/dialog source, both themes | Original radii/surfaces retained; conflicting global border override removed |
| Animations | Copied chart/loading source, browser run with reduced motion | No new entrance choreography; 10% animation-panel replay not verified |
| Icons | Original local brand/token/network assets, header/widget screenshots | Reference artwork and controls reused |
| Performance | History endpoint, native quote lifecycle, build | History cache and in-flight reuse verified; no synthetic chart data |

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| High | Borrow layout | Large introductory block; form in the wide left column | Copied chart-left / 400px borrow-right composition | Restores the reference hierarchy and primary task focus |
| Medium | Shared primitives | Rewritten approximations and conflicting global styles | Original source files with small prop adapters | Preserves actual spacing, borders, sizing, and focus states |
| Medium | Rate history | Chart omitted | Copied interactive chart backed by real Aave observations | Restores the central analytical surface without invented values |
| Medium | Position preview | Dense technical text | Copied compact 2×2 metrics with expandable account details | Keeps key risk metrics scannable while retaining exact identity |

Considered and rejected: copying the allocation optimizer would violate the one-market account model; copying unrelated history providers would misrepresent supported venues. Those product bindings were adapted while retaining the visual component source.

Verification: `pnpm typecheck` passed; `pnpm test` passed 28 tests; production web build passed; browser wallet suite passed with zero page errors. The browser also checked 400px/right-side placement, chart period changes and keyboard readout, network menu, settings, add/remove collateral rows, token picker, light/dark desktop/mobile, and native creation/management. Aikido found no issues in 15 adapted files plus the final test-script follow-up. Verdict: approved within this scope; 10% animation-panel replay remains unverified.
