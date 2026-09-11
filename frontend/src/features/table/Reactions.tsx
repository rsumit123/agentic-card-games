import { useState } from 'react';

/** Six reactions, relayed by the server.
 *
 *  A four-person room already knows each other, so the thing worth building
 *  is the shrug after a bad beat, not a chat client. */
export const REACTIONS = ['👍', '😂', '😮', '😤', '🎉', '🤔'] as const;

export function Reactions({ onReact }: { onReact: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reactions">
      {open && (
        <div className="reactions-tray" role="group" aria-label="Reactions">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="reaction" aria-label={`React ${emoji}`}
              onClick={() => { onReact(emoji); setOpen(false); }}>{emoji}</button>
          ))}
        </div>
      )}
      <button type="button" className="icon-button reactions-open" aria-expanded={open}
        aria-label={open ? 'Close reactions' : 'React'} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '×' : '☺'}</span>
      </button>
    </div>
  );
}
