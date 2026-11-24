import { notFound } from 'next/navigation';
import { getNetwork } from '@/lib/networks';

export default async function ChainLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  if (!getNetwork(Number(chainId))) notFound();
  return children;
}
