import { useState } from 'react';
import { leaveTable, endTable, sitOut, sitIn } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Button } from '../../components/Button';

export function LeaveEndControls({ tableId, isHost, handInProgress, sittingOut = false, onLeft }: { tableId: number; isHost: boolean; handInProgress: boolean; sittingOut?: boolean; onLeft: () => void }) {
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
    {/* Someone always has to answer the door. Without this the alternative is
        being timed out hand after hand. */}
    <Button onClick={() => run(() => (sittingOut ? sitIn(tableId) : sitOut(tableId)))} busy={busy}>
      {sittingOut ? 'Sit back in' : 'Sit out next hand'}
    </Button>
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
