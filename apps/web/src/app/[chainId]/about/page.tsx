import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'About | Aave positions',
  description: 'Shared liquidity, configurable collateral groups, and borrower-level risk boundaries in Aave V4.',
};

export default async function AboutPage({ params }: { params: Promise<{ chainId: string }> }) { const { chainId } = await params; return <AppShell chainId={Number(chainId)} section="about" />; }
