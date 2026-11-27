# Reference UI copy

Full review of confirmation dialogs, settings and asset modals, transaction feedback, morphing text/icons, management action tabs, and errors/warnings. Reference: `/Users/saurabh/Desktop/codex/onchain-borrow-aggregator/apps/web`. Both apps use React/Next.js, Tailwind, Base UI, Motion, and shared CSS tokens. This is a UI integration review, not a protocol/security audit.

Copied `morphing-text.tsx`, `transaction-status.tsx`, and `motion-action-tabs.tsx` directly. Copied `confirmation-dialog.tsx` with adapters for Aave's edit action, existing Motion buttons, navigation semantics, and persistent status placement. Existing reference styles, network selector, shimmering text, picker composition, and shared primitives are reused. No dependencies were added. Aave's additional actions, market/account details, and execution hook remain Aave-specific.

| Category | Evidence inspected | Result |
| --- | --- | --- |
| Typography | Morphing labels, summary values, addresses, long errors; mobile screenshots | Fixed navigation-button contrast; retained tabular numbers and root antialiasing |
| Surfaces | Settings, picker, review, management; 1440/768/390px | Reference header/body/footer composition; scrollable details and bounded status area |
| Animations | Status changes, status-height changes, shimmer, action tabs, modal motion | Copied transitions; normal/reduced-motion browser checks pass |
| Icons | Spinner/check/error/warning, theme icon, close controls | Copied contextual morphs; visible labels accompany state colors |
| Performance | New components, existing CSS, observer cleanup | No new dependency; specific animated properties; ResizeObserver disconnects |

Findings below were addressed in this copy.

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| Medium | `apps/web/src/components/review-dialog.tsx:25`, `position-management.tsx:31` | Separate modal compositions and raw phase labels | Shared reference confirmation shell, amount summary, footer, and readable phase text | Consistent hierarchy and feedback |
| Medium | `apps/web/src/components/transaction-status.tsx:28`, `morphing-text.tsx:6`, `aave-transaction-status.tsx:15` | Disconnected banners and changing button text | Reference status row, animated icons/text, shimmer, live announcements | Contextual motion with static cues |
| Medium | `apps/web/src/components/motion-action-tabs.tsx:5`, `position-management.tsx:38` | Native action select | Reference sliding tabs, adapted to seven Aave actions with horizontal scrolling | Consistent interaction; arrow/Home/End navigation |
| High | `apps/web/src/components/review-dialog.tsx:19`, `confirmation-dialog.tsx:48`, `borrow-workspace.tsx:122` | Native-state-pending counted as indefinitely busy | Warning status plus Close/View positions; no resubmit action in an uncertain state | Avoid trapping users after a mined transaction |
| Medium | `apps/web/src/app/confirmation-ui.css:2`, `confirmation-dialog.tsx:54` | Long detail content could bury progress | Status and actions remain outside the detail scroller; long errors scroll within a bounded area | Feedback remains visible on small screens |
| High | `apps/web/src/app/aave-shell.css:10`, `confirmation-dialog.tsx:58` | Global link rule overrode copied success-button text color | Button links retain variant colors and explicit link semantics | Readable action text in light/dark themes |
| Medium | `apps/web/src/components/inline-notice.tsx:6`, `borrow-workspace.tsx:84`, `positions-view.tsx:30` | Quote failures could disappear; loading/unavailable positions resembled an empty result | Shared warning treatment, explicit loading and unavailable states | Accurate status communication |
| Medium | `apps/web/src/components/amount-panel.tsx:37`, `amount-field.tsx:12` | Invalid amount relied on field styling | Visible wallet-balance explanation associated with the input, including zero balance | Do not rely on color alone |
| Medium | `apps/web/src/components/review-dialog.tsx:28`, `borrow-workspace.tsx:59` | Stale plan disabled signing without an available refresh action; prepare errors could reject uncaught | Refresh/simulate remains available; handled preparation rejection | Recoverable error flow |
| Medium | `apps/web/src/components/position-management.tsx:31` | Success immediately closed the dialog | Reference completed status and Close action; refresh on close | Allow users to perceive confirmation |

Considered and rejected:

| Location | Candidate | Rejected because |
| --- | --- | --- |
| Shared `ui/dialog.tsx` | Replace the existing Animate UI primitive | It already supplies the project's reference surface and tested keyboard/focus behavior |
| Aave execution hook | Copy aggregator transaction code | Its protocol operations and account model differ; a presentation adapter preserves Aave execution |
| Management tabs | Remove actions absent from the reference app | Aave needs borrow, repay-all, collateral toggles, and close in addition to add/remove/repay |

Verification:

- `pnpm --filter @aave-isolated/web typecheck`: passes.
- `pnpm --filter @aave-isolated/web test`: 23 tests pass.
- `pnpm --filter @aave-isolated/web build`: passes. Dependency warnings remain for MetaMask's optional React Native storage import and viem/ox's dynamic import.
- `node scripts/check-dialog.cjs` with the installed Chromium path: six viewport/motion combinations pass, including settings changes, centering, keyboard open/close, and focus restoration.
- Temporary local fixture exercised idle, approving, simulating, signing, confirming, error, pending-native, and success: 48 combinations across three widths and two motion preferences pass. Light and dark screenshots inspected. Long errors, footer visibility, busy Escape handling, reduced-motion spinner, success-link contrast, management tab keys, preview, wallet error, edit and cancel were checked. Fixture route removed after testing.
- Browser smoke suite without transactions passes with zero page errors.
- `RUN_LOCAL_WALLET_UI=1 node scripts/browser-checks.cjs` with the installed Chromium path: passes with zero browser errors. Exercised the local wallet chooser, V4 quote selection, native review, network-change rejection, signature rejection, same-intent retry, position creation, position detail, management preview, a second collateral transaction, persistent success confirmation, and mobile layouts. Test selection uses catalog token IDs to locate the intended reserve tokens.

Not verified: screen-reader audio output, animation replay at exactly 10% speed, hardware/mobile wallet applications, every external wallet/provider error string. The fixture's pending-native state is simulated; it is not evidence of a live delayed-indexing event.

Verdict: **Approve** for the copied UI within the stated boundary. Unverified: screen-reader audio, exact 10% animation replay, external wallet applications/error strings, and a live delayed-indexing event.

## Backdrop regression follow-up

The initial fixture review did not reproduce the page's dialog hierarchy. In the real borrow workspace, review and asset picker were nested under the closed settings root. Base UI suppresses nested backdrops by default, leaving these dialogs without dimming or blur. They are now siblings of the settings dialog. The shared backdrop styling is unchanged.

The regression check first failed with zero picker backdrops. After the fix, settings/picker checks pass at 1440, 768, and 390 pixels with normal and reduced motion, including a viewport-sized, nontransparent, blurred backdrop and retained focus behavior. Typecheck passes. The wallet browser suite now also asserts that the real review has its own backdrop.

Real borrow review verification also passes with the connected local test wallet at desktop/mobile widths in light/dark themes. Captured screenshots confirm the restored dimming and blur; this check did not submit transactions.
