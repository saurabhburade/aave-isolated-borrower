'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import type { Position } from '@/lib/domain';
import { shortAddress } from '@/lib/utils';
import { AccountAvatar } from './account-avatar';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { MotionIcon } from './ui/motion-icon';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export function SubaccountDetails({ position }: { position: Position }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyStatus('idle'), 5000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(position.account);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
  }

  return <Dialog onOpenChange={() => setCopyStatus('idle')}>
    <TooltipProvider delay={150}><Tooltip>
      <TooltipTrigger render={<DialogTrigger className="portfolio-subaccount-trigger" aria-label={`View subaccount ${shortAddress(position.account)}`} />}>
        {shortAddress(position.account)}
      </TooltipTrigger>
      <TooltipContent>Click to view subaccount</TooltipContent>
    </Tooltip></TooltipProvider>
    <DialogContent className="review-dialog subaccount-detail-dialog">
      <DialogHeader className="review-header">
        <DialogTitle>Subaccount details</DialogTitle>
        <DialogDescription className="sr-only">View and copy this subaccount’s address or open Aave.</DialogDescription>
      </DialogHeader>
      <div className="review-scroll subaccount-detail-body">
        <div className="subaccount-detail-identity">
          <AccountAvatar address={position.account} />
          <strong>{position.account}</strong>
        </div>
        <dl className="subaccount-detail-metadata">
          <div><dt>Market</dt><dd>{position.market.name}</dd></div>
          <div><dt>Network</dt><dd>{position.market.network}</dd></div>
        </dl>
        <p className="subaccount-detail-feedback" role="status">{copyStatus === 'error' ? 'Could not copy. Please try again.' : ''}</p>
      </div>
      <div className="review-footer"><div>
        <Button variant="outline" onClick={copyAddress}>
          <MotionIcon icon={copyStatus === 'copied' ? Check : Copy} state={copyStatus} />
          <span>{copyStatus === 'copied' ? 'Copied!' : 'Copy address'}</span>
        </Button>
        <Button nativeButton={false} role="link" render={<a href={position.market.version === 4 ? 'https://pro.aave.com/' : 'https://app.aave.com/dashboard/'} target="_blank" rel="noopener noreferrer" />}>
          <span>View on Aave</span><ArrowUpRight aria-hidden="true" />
        </Button>
      </div></div>
    </DialogContent>
  </Dialog>;
}
