import { useState } from 'react';
import type { AiTier, AiTierInfo } from '../../domain/table';
import { Button } from '../../components/Button';

const FALLBACK: AiTierInfo[] = [
  { tier: 'Easy', model: '', label: '' },
  { tier: 'Medium', model: '', label: '' },
  { tier: 'Hard', model: '', label: '' },
];

export function AiSeatMenu({ tiers, onPick, busy }: { tiers: AiTierInfo[]; onPick: (tier: AiTier) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const options = tiers.length > 0 ? tiers : FALLBACK;
  const choose = (tier: AiTier) => { setOpen(false); onPick(tier); };
  return (
    <div className="ai-menu">
      <Button onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} busy={busy}>
        Play with an LLM
      </Button>
      {open && (
        <ul role="menu">
          {options.map((option) => (
            <li
              key={option.tier}
              role="menuitem"
              tabIndex={0}
              onClick={() => choose(option.tier)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') choose(option.tier); }}
            >
              <span className="tier-name">{option.tier}</span>
              {option.label && <span className="tier-model">{option.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
