import { useState } from 'react';
import { leaveTable, endTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Button } from '../../components/Button';

export function LeaveEndControls({ tableId, isHost, handInProgress, onLeft }: { tableId: number; isHost: boolean; handInProgress: boolean; onLeft: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (operation: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError(null);
    try { await operation(); after?.(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Something went wrong.'); }
    finally { setBusy(false); setConfirming(false); }
  };
  return <div className="leave-end">
    <Button onClick={() => run(() => leaveTable(tableId), onLeft)} busy={busy}>Leave table</Button>
    {isHost && !confirming && <Button variant="danger" disabled={handInProgress} onClick={() => setConfirming(true)}>End session</Button>}
    {isHost && confirming && <div role="group" aria-label="Confirm end">
      <p>The session ends for everyone.</p>
      <Button variant="danger" busy={busy} onClick={() => run(() => endTable(tableId))}>End for everyone</Button>
      <Button onClick={() => setConfirming(false)}>Keep playing</Button>
    </div>}
    {handInProgress && isHost && <small>You can end the session between hands.</small>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
