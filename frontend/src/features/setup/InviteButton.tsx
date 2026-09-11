import { useState } from 'react';

/** Getting three friends into the room is the front door of the whole product.
 *  A code to retype is the slowest way to do it, so this hands the phone's own
 *  share sheet a link, and falls back to the clipboard where there isn't one. */
/** Hand the phone's own share sheet the join link, or the clipboard if there
 *  is no share sheet to hand it to. */
export async function shareInvite(code: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const link = `${window.location.origin}/join/${code}`;
  const text = `Join my poker table. Code ${code}: ${link}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'The Common Table', text: `Join my poker table. Code ${code}.`, url: link }); return 'shared'; }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // A share the player cancelled is not a failure worth reporting.
    return 'cancelled';
  }
}

export function InviteButton({ code }: { code: string }) {
  const [said, setSaid] = useState<string | null>(null);

  const say = (message: string | null) => {
    setSaid(message);
    if (message) setTimeout(() => setSaid(null), 2400);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); say('Code copied'); }
    catch { say(null); }
  };

  const share = async () => {
    const result = await shareInvite(code);
    say(result === 'copied' ? 'Invite copied' : null);
  };

  return <div className="invite">
    <span className="invite-actions">
      <button type="button" className="btn" onClick={copy}>Copy</button>
      <button type="button" className="btn btn-primary" onClick={share}>Share</button>
    </span>
    <span role="status" className="invite-said">{said}</span>
  </div>;
}
