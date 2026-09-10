import type { PublicState } from '../../domain/game';

export function HandResult({ pub }: { pub: PublicState }) {
  if (pub.street !== 'complete' || pub.payouts.length === 0) return null;
  return <div role="status" aria-label="Hand result" className="hand-result">
    {pub.payouts.map(([seat, amount]) => <p key={seat}>{pub.names[seat] ?? `Seat ${seat}`} wins {amount.toLocaleString()}</p>)}
  </div>;
}
