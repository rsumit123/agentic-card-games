import { useState } from 'react';
import type { AiTier, AiTierInfo } from '../../domain/table';
import { Button } from '../../components/Button';

const FALLBACK: AiTierInfo[] = [
  { tier: 'Easy', model: '', label: '' },
  { tier: 'Medium', model: '', label: '' },
  { tier: 'Hard', model: '', label: '' },
];

export function AiSeatMenu({ tiers, onPick, onRemove, busy, label = 'Play with an LLM', compact = false }: {
  tiers: AiTierInfo[];
  onPick: (tier: AiTier) => void;
  onRemove?: () => void;
  busy: boolean;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const options = tiers.length > 0 ? tiers : FALLBACK;
  const choose = (tier: AiTier) => { setOpen(false); onPick(tier); };
  return (
    <div className={`ai-menu ${compact ? 'ai-menu-compact' : ''}`}>
      <Button onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} busy={busy}
        aria-label={compact ? 'Change or remove this house player' : undefined}>
        {label}
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
          {onRemove && (
            <li role="menuitem" tabIndex={0} className="tier-remove"
              onClick={() => { setOpen(false); onRemove(); }}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setOpen(false); onRemove(); } }}>
              <span className="tier-name">Remove player</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
