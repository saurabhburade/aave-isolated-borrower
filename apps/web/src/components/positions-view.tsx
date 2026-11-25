'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import type { Position } from '@/lib/domain';
import { usePositions } from '@/hooks/use-protocol-data';
import { PositionManagementDialog } from '@/components/position-management';
import { PositionsPortfolio } from '@/components/positions-portfolio';

export function PositionsView({ chainId }: { chainId: number }) {
  const { address } = useAccount();
  return <PositionsContent key={chainId + ':' + address} chainId={chainId} address={address} />;
}

function PositionsContent({ chainId, address }: { chainId: number; address?: `0x${string}` }) {
  const { positions, freshness, loading, refresh } = usePositions(chainId, address ?? null);
  const [selected, setSelected] = useState<Position | null>(null);

  return <>
    <PositionsPortfolio chainId={chainId} owner={address} positions={positions} freshness={freshness} loading={loading} onRefresh={refresh} onManage={setSelected} />
    {address ? <PositionManagementDialog position={selected} owner={address} open={Boolean(selected)} onClose={() => setSelected(null)} onComplete={() => { setSelected(null); refresh(); }} /> : null}
  </>;
}
