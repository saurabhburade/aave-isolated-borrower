export function AboutView() {
  return (
    <article className="about-page" aria-labelledby="about-title">
      <h1 id="about-title">Aave V4: liquidity vs risk</h1>
      <div className="about-copy">
        <p>
          Aave V4’s Hub &amp; Spoke architecture separates liquidity from risk.
          Spokes define their own collateral configurations, risk parameters, and
          liquidation rules, while connected Spokes can access liquidity from a
          shared Hub. But there’s another dimension worth exploring:
          borrower-level risk isolation.
        </p>

        <section aria-labelledby="about-liquidity">
          <h2 id="about-liquidity">Shared liquidity, distinct risk</h2>
          <p>
            The Prime Hub provides a shared liquidity layer. A Bluechip Spoke
            might accept WETH, wstETH, WBTC, and cbBTC. A Main Spoke might also
            include weETH, while other Spokes serve dedicated markets. Each
            Spoke has its own risk configuration. Shared Hub liquidity does not
            mean identical collateral risk.
          </p>
        </section>

        <section aria-labelledby="about-tradeoff">
          <h2 id="about-tradeoff">The borrower-level trade-off</h2>
          <p>
            Cross-margining WETH, wstETH, and WBTC in a shared collateral pool
            offers more capital efficiency, but also shares position risk.
            Separating WETH and wstETH into one position and WBTC into another
            creates independent risk boundaries, with less cross-position
            capital efficiency.
          </p>
          <p>Why must borrowers choose one extreme?</p>
        </section>

        <section aria-labelledby="about-groups">
          <h2 id="about-groups">Configurable collateral groups</h2>
          <p>
            A borrower can group assets into separate subaccounts, choosing
            which collateral to cross-margin and which to isolate. For example:
          </p>
          <ul>
            <li><strong>Subaccount A:</strong> WETH and wstETH, cross-margined with their own health factor.</li>
            <li><strong>Subaccount B:</strong> WBTC, isolated with its own health factor.</li>
            <li><strong>Subaccount C:</strong> cbBTC, isolated with its own health factor.</li>
          </ul>
          <p>
            All three access the same Bluechip Spoke and Prime Hub liquidity,
            subject to protocol limits.
          </p>
        </section>

        <section aria-labelledby="about-shock">
          <h2 id="about-shock">A collateral shock in one subaccount</h2>
          <p>
            If a wstETH price shock pushes Subaccount A’s health factor below 1,
            A becomes liquidatable. Eligible collateral within A, including its
            WETH, is exposed.
          </p>
          <p>
            Subaccount B’s WBTC remains in an independent position with an
            independent health factor. It is not included in A’s liquidation
            boundary. The same Bluechip Spoke, with separate risk boundaries.
          </p>
        </section>

        <p className="about-source">
          <a href="https://x.com/saurabh_evm/status/2124153197103353857" target="_blank" rel="noopener noreferrer">Read the original post by saurabh_evm</a>
        </p>
      </div>
    </article>
  );
}
