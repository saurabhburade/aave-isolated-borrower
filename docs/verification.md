# Verification results

Observed on 2026-11-25 in the integrated workspace. No files were staged or committed, and no public-chain transactions were sent. The reference repository was read-only; its three existing changed files remained unchanged by this work.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Static types | `pnpm typecheck` | Web and indexer passed |
| Unit tests | `pnpm test` | 28 passed: 7 contract mock/unit, 19 web/domain/history/RPC, 2 indexer identity tests |
| Contract formatting | `pnpm check:contracts` | Passed |
| Production build | `pnpm build` | Contracts and Next.js production build passed |
| Indexer generation | `pnpm --filter @aave-isolated/indexer codegen` | Passed |
| Native lifecycle | `ETHEREUM_RPC_URL=http://127.0.0.1:8557 pnpm test:fork` | 2 passed, none skipped; actual V3 Pool and V4 Spoke |
| Funded API integration | `pnpm --filter @aave-isolated/web test:integration` | Passed against the dRPC-backed local Ethereum fork |
| Browser + wallet | `HEADLESS_CHROMIUM=<local-compatible-Chromium> RUN_LOCAL_WALLET_UI=1 pnpm --filter @aave-isolated/web test:browser` | Passed; disposable local wallet and browser context |
| Setup syntax | `bash -n contracts/script/start-local.sh contracts/script/deploy-local.sh contracts/script/fund-local.sh` and `node --check contracts/script/rpc-throttle.mjs` | Passed |
| Source scan | Authorized Aikido scan of 24 current UI/execution/deployment files, plus changed-file follow-up | No issues; no skipped paths |
| Local credential patterns | Source-only scan excluding generated/dependency/build paths | No matching credential patterns |

The exact browser executable used was `/Users/saurabh/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell`. Local browser launch required desktop sandbox approval. The test uses an isolated Chromium context; it never reads or changes the personal browser profile.

## Native protocol evidence

The Ethereum source was `https://eth.drpc.org`, pinned at block **26491052**, served as local chain **31337** at port **8557**. A read-only local transport at **8558** forwards source reads at four requests/second. Initial direct attempts hit public-endpoint HTTP 429; queueing resolved the broad reserve scan. Successful test execution used local block 26491109 for its nested fork, retaining the same Ethereum source state plus disposable setup transactions.

- V3: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`, revision 12.
- V4 Main Spoke: `0x94e7A5dCbE816e498b89aB752661904E2F56c485`.
- V4 Hub: `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9`.
- Both native tests create, supply, enable collateral, borrow, repay all, withdraw, and confirm zero debt. V4 additionally starts with WETH and adds wstETH to the same account; the native health factor increases and both collateral reserves close successfully.

The funded integration creates two distinct same-owner/same-Pool V3 accounts and one V4 account. It checks exact owner-originated read-only simulation, non-persistent simulated approvals/deployment, unchanged reviewed limits/hash, independent balances, same-account V4 second collateral, a native-risk-invalid partial withdrawal, invalid collateral disable, valid partial withdrawal, partial repayment, all-debt closure, retained history, and rejection of reusing a deployed creation intent.

Mock tests additionally cover unauthorized execution, cross-venue actions, atomic rollback, expired terms, duplicate salts, protective repayment, callback reentrancy, and the final V4 risk-premium rate guard. Mock coverage is distinct from the native lifecycle evidence above.

## UI evidence

The final interface reuses the reference’s Inter typography, current light/dark surfaces, amount-field primitives, local token artwork, picker structure, rounded controls, market/portfolio tables, 1200px shell, 400px secondary column, and 20px panel radii. No reference files were edited.

The browser check exercises native token search/selection, All/V3/V4 filter stability, exact review, live wrong-chain rejection before signing, rejected signature recovery using the same intent, native creation confirmation, detail balances, and adding wstETH to that same V4 account through management. It checks keyboard navigation, reduced motion, desktop 1440×1000 and mobile 390×844, light/dark themes, mobile management/detail width, and zero browser page errors.

[Borrow light](screenshots/desktop-light-funded.png), [borrow dark](screenshots/desktop-dark.png), [mobile dark](screenshots/mobile-dark.png), [management review](screenshots/management-review-light.png), [mobile management](screenshots/management-review-mobile-dark.png), and [mobile position detail](screenshots/position-mobile-dark.png) are saved in `docs/screenshots/`; settled theme transitions are captured after rendering. Long native health factors are formatted for display without altering the values used by execution.

## Remaining limits

- Only the independently verified local Ethereum fork executes. No public application factory or public deployment is configured.
- Envio schema/handlers/code generation/type checks pass; its Docker/Postgres runtime was not started. Native factory-log discovery and account reads were exercised without it.
- USDC historical charts now use real indexed Aave V3/V4 data. V4 chart history is its base rate before account premium. Other debt assets have an explicit history-unavailable state. Current balances include native accrual; separately attributed interest and some V4 position APYs remain explicitly unknown.
- Dependency audit retains one high advisory in transitive Zod 3 (oversized collection memory exhaustion) and one moderate advisory in transitive uuid 8/9 (buffer bounds). Compatible upstream wallet SDK updates are still needed; incompatible major overrides were not forced. Source scan results do not clear dependency advisories.
- Public dRPC quotas/retention can change. Cold inventory reads can take minutes through the queue. RPC, code-hash, reserve, or native-simulation failures keep affected execution unavailable.
- Foundry cache writes outside the workspace emitted sandbox warnings; tests themselves passed. Optional React Native storage bundling warnings come from an unused wallet SDK path; the production build completed.

## Direct component copy update

Following the screenshot correction, shared components were copied directly from the reference. Nineteen primitive files and 87 chart/source-notice files match byte for byte. The borrow widget and preview now occupy the right-hand 400px column, with the wide chart, account flow, and single-market comparison on the left. The reference’s exact stylesheet and local artwork are used; conflicting global button/border/font overrides were removed.

See [component provenance](ui-component-copy.md). Product props preserve native multi-collateral accounts and the existing signing safeguards. The history API uses only official Aave endpoints, verified Pool/Spoke addresses, USDC reserve 7/Hub asset 5 for V4, a 4096-sample bound, finite-rate validation, five-minute caching, and shared in-flight requests. Observed integrated 7D response: **168 V3 samples and 84 V4 samples**, both with real APYs. The chart supports keyboard inspection and 1D/7D/30D/90D controls.

Fresh checks after copying: `pnpm typecheck`, `pnpm test` (28 tests), production web build, dependency audit (same two transitive advisories), and the local wallet/browser suite. An authorized Aikido scan of the 15 adapted UI/history files and final browser-script follow-up found no issues and skipped no files. No contracts or protocol execution behavior changed in this UI update. Reference Git status still shows only its three pre-existing edits.

## Local shadcn Motion extensions

The design kit remains in `apps/web/src/components/ui`. `MotionButton` composes the existing shadcn Button with `motion.create`; `MotionIcon` uses keyed presence transitions; `MotionProvider` applies reduced-motion preferences. Header/widget controls use the extension components. `apps/web/components.json` records the existing Base Rhea style and aliases. No workspace package or runtime dependency was added.

Fresh checks: web `typecheck` and production `build` passed, `pnpm test` passed 28 tests, and the complete local wallet/browser flow passed. `scripts/check-motion.cjs` observed a normal press scale of **0.960** and a reduced-motion scale of **1.000**, with working pointer/keyboard activation, retained shadcn variant/size attributes, one settled decorative icon, and no page errors. Aikido scanned eight changed UI/script files without issues or skipped paths.


## Dynamic market discovery - November 25, 2026

- Web type checking and 64 unit/script tests passed, covering catalog-based V3/V4 discovery without manifest entries, selected-market/token inventories, foreign-chain and arbitrary-venue rejection, factory/venue pins, failed-read retry, block-hash cache invalidation, and exact multi-Hub debt-reserve binding.
- Market-comparison browser regression passed for filtering, sorting, manual selection, multiple collateral inputs, indexed USD/risk values and loading states.
- Aave V3 Ethereum Lido, absent from `local.json`, produced an executable quote and a fresh review plan for 1 WETH collateral / 4 USDC debt using the existing local factory.
- A disposable browser verified the Lido market quote request, absence of the old configuration warning, immediate review summary and automatic preparation before signing. A later isolated API/RPC browser check verified that quotes include ready signing plans, opening review makes no second preparation request, checking is visible, and failed/empty quotes can be retried through Refresh. These checks submitted no transactions.

- The optimized web production build passed (existing wallet SDK dependency warnings remain).
- During final live verification the local web server stopped and was restarted. Anvil on port 8557 remained listening but stopped answering chain-ID and state-export requests. A process sample showed multiple workers waiting on backend locks. Restarting only the read-only upstream proxy did not recover the fork. No Anvil reset or position-state deletion was performed. The latest ready-review and retry UI checks therefore used isolated API/RPC fixtures; earlier Lido quote/review checks completed against the live fork.


## Snapshot recovery - November 26, 2026

The stopped fork and wallet proxy were restored from `/tmp/aave-local-anvil-state.json` after verifying its factory bytecode hash against `contracts/config/local.json`. The restored block was 26491059; the saved snapshot contained 58 accounts and seven transactions. Both port 8557 and wallet port 8556 returned HTTP 200 and chain 31337. Read-only checks confirmed 1,000 WETH and 1,000,000 USDC for the local test owner. `/api/markets?summary=true` returned 21 candidates with fresh factory availability, and the app returned an executable 1 WETH / 2 USDC V3 quote with a fresh signing plan. No factory redeployment or local position-reset operation was needed. The resumed fork periodically saves checkpoints to `contracts/cache/anvil-restored-state.json`. A cold quote took about 58 seconds, so the browser quote timeout was extended to 90 seconds; checking stays visible and failed checks remain retryable.

The final live browser check passed against the restored fork: it connected the disposable wallet, obtained an executable dynamic Lido quote with a prepared signing plan, opened review directly at Approve & sign without another preparation request, and successfully retried injected failed/empty quote responses. No transactions were submitted by these checks.


## Confirmation waiting - November 26, 2026

The transaction flow explicitly waits for one receipt confirmation, then polls fresh position state instead of stopping after one native read. Status copy now says “Transaction confirmed” while that read catches up. Seven focused tests cover retries after unavailable/absent/stale/old-block state, account/owner/venue/chain mismatches, transport/malformed-response errors, management closure, bounded timeout, in-flight cancellation and a response completing after dismissal. The cancellation-response regression was observed failing before its guard was added. Web type checking and all 71 tests passed.


## Confirmed position listing — November 26, 2026

The confirmed creation transaction `0xd20e508870fcac7aad6bce9bacaaff48ca9811d75204875db1f65e38af0d1458` emitted account `0x66A1fb45D92dcd5E4D9b32a4649D1d66E8B0609E` at block 26491061 for the local owner. Before the fix, the Positions endpoint exceeded a 15-second verification deadline while scanning the full V3 market. After using native active reserve IDs plus account action tokens, the same endpoint returned the open account and fresh balances in about two seconds: approximately 1 WETH collateral and 4.000002 USDC debt. Its management catalog retained 68 assets. A read-only live browser confirmed the account appears in both My positions and Subaccounts with WETH and USDC displayed. Web type checking and all 77 tests passed, including reserve-ID gaps, disabled supplies, externally active configuration, complete-inventory fallback, V4 fallback and V4 management asset identities. The verification submitted no transactions.
