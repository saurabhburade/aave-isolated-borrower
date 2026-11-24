'use client';

import Image from 'next/image';

export function AppFooter() {
  return (
    <footer className="app-footer">
      <div className="shell-inner footer-inner">
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="https://x.com/saurabh_evm" target="_blank" rel="noopener noreferrer">Built by saurabh_evm</a>
        </nav>
        <nav className="footer-protocols" aria-label="Underlying protocols">
          <span>Powered by</span>
          <a href="https://aave.com" target="_blank" rel="noopener noreferrer">
            <Image src="/brand/aave.svg" alt="Aave" width={96} height={16} />
          </a>
        </nav>
      </div>
    </footer>
  );
}
