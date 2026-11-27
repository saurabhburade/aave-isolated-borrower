# Reused UI sources

Bundled USDT and DAI token artwork was retrieved from the Family token logo URLs returned by the Aave Ethereum reserve catalog. These logos identify their respective tokens; token and brand marks remain the property of their owners.

The UI adapts the current working components and CSS from the local `onchain-borrow-aggregator/apps/web` reference with the user’s authorization. The reference was read-only throughout. Reused pieces include Inter styling, shadcn/Base UI button/card/input/dialog/field/input-group conventions, token artwork, picker structure, and portfolio/market table styling.

Full reused-source MIT notices are preserved in `docs/licenses/`. The package manager retains dependency license metadata in the installed packages. shadcn/ui source is MIT licensed: https://github.com/shadcn-ui/ui/blob/main/LICENSE.md. Base UI is MIT licensed: https://github.com/mui/base-ui/blob/master/LICENSE. The chart components are copied from the reference, with the original MIT notice preserved at `apps/web/src/components/charts/LICENSE-bklit` and the pattern notice at `apps/web/src/components/charts/patterns/LICENSE-visx-pattern`. The shadcn CSS utilities are vendored as source at `apps/web/src/app/shadcn-utilities.css`, covered by the preserved shadcn MIT notice. Chart data is real indexed Aave V3/V4 history for the selected loan asset and matching markets; reserves without provider history show an unavailable state.

The shared Dialog and Checkbox use `@animate-ui/react` 2.4.6, by Elliot Sutton, under its MIT + Commons Clause License Condition. The license permits use within applications, websites, and products, and restricts selling or redistributing the components themselves in their original form. The complete notice is preserved in `docs/licenses/Animate-UI-LICENSE.md` and in the installed package.

The subaccount avatar generator adapts Minidenticons by Laurent Payot (MIT): https://github.com/laurentpayot/minidenticons. The complete notice is preserved in `docs/licenses/Minidenticons-LICENSE`.

