import { useState } from 'react';
import { Sheet } from './TableMenus';
import { soundEnabled, setSoundEnabled } from './useTableSound';

const RANKINGS = [
  'Straight flush', 'Four of a kind', 'Full house', 'Flush',
  'Straight', 'Three of a kind', 'Two pair', 'One pair', 'High card',
];

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sound, setSound] = useState(soundEnabled);
  const [rankings, setRankings] = useState(false);

  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <label className="sheet-row">
        <span>Sound and vibration</span>
        <input type="checkbox" role="switch" checked={sound}
          onChange={(event) => { setSoundEnabled(event.target.checked); setSound(event.target.checked); }} />
      </label>

      <button type="button" className="sheet-row sheet-row-button" aria-expanded={rankings}
        onClick={() => setRankings((value) => !value)}>
        <span>What beats what</span>
        <span aria-hidden="true">{rankings ? '−' : '+'}</span>
      </button>
      {rankings && (
        <ol className="rankings">
          {RANKINGS.map((name) => <li key={name}>{name}</li>)}
        </ol>
      )}
    </Sheet>
  );
}
