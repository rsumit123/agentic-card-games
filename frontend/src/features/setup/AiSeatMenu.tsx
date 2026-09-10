import { useState } from 'react';
import type { AiTier } from '../../domain/table';
import { Button } from '../../components/Button';

const TIERS: AiTier[] = ['Easy', 'Medium', 'Hard'];
export function AiSeatMenu({ onPick, busy }: { onPick: (tier: AiTier) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-menu">
      <Button onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open} busy={busy}>Add player</Button>
      {open && <ul role="menu">{TIERS.map((tier) => <li key={tier} role="menuitem" tabIndex={0} onClick={() => { setOpen(false); onPick(tier); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setOpen(false); onPick(tier); } }}>{tier}</li>)}</ul>}
    </div>
  );
}
