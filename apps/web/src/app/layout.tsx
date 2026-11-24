import type { Metadata } from 'next';
import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { Inter } from 'next/font/google';
import { WalletProviders } from '@/components/wallet-providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
export const metadata: Metadata = { title: 'Aave positions', description: 'Native, chain-scoped Aave borrowing positions.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning className={inter.variable}><head><script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('aave-isolated-theme')==='dark')document.documentElement.classList.add('dark')}catch{}" }} /></head><body><WalletProviders>{children}</WalletProviders></body></html>;
}
