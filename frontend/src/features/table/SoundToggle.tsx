import { useState } from 'react';
import { soundEnabled, setSoundEnabled } from './useTableSound';

/** Sound is off until asked for, and the first tap is also what unlocks audio
 *  playback in the browser. */
export function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  return (
    <button type="button" className="sound-toggle" aria-pressed={on}
      onClick={() => { const next = !on; setSoundEnabled(next); setOn(next); }}>
      <span aria-hidden="true">{on ? '\u{1F50A}' : '\u{1F507}'}</span>
      <span className="sr-only">{on ? 'Turn sound off' : 'Turn sound on'}</span>
    </button>
  );
}
