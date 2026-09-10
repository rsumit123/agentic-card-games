import { useState } from 'react';

/** Getting three friends into the room is the front door of the whole product.
 *  A code to retype is the slowest way to do it, so this hands the phone's own
 *  share sheet a link, and falls back to the clipboard where there isn't one. */
export function InviteButton({ code }: { code: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const link = `${window.location.origin}/join/${code}`;
  const text = `Join my poker table. Code ${code}: ${link}`;

  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'The Common Table', text: `Join my poker table. Code ${code}.`, url: link }); return; }
      await navigator.clipboard.writeText(text);
      setSaid('Invite copied');
    } catch {
      // A share the player cancelled is not a failure worth reporting.
      setSaid(null);
    }
    setTimeout(() => setSaid(null), 2400);
  };

  return <div className="invite">
    <button type="button" className="btn btn-primary" onClick={share}>Invite a friend</button>
    <span role="status" className="invite-said">{said}</span>
  </div>;
}
