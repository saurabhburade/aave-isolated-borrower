export function ProtocolMark({ venue }: { venue: string }) {
  return <span className="protocol-mark" title={venue}><img src="/tokens/aave.png" alt="" width={28} height={28} /></span>;
}
