import { useEffect, useState } from 'react';
import type { AiTier, AiTierInfo, TableView } from '../../domain/table';
import { clearAiSeat, fillAiSeat, startTable } from '../../api/tables';
import { listAiTiers } from '../../api/ai';
import { ApiError } from '../../api/http';
import { useSession } from '../../store/session';
import { Button } from '../../components/Button';
import { InviteButton, shareInvite } from './InviteButton';
import { RecoveryNotice } from '../table/RecoveryNotice';
import './setup.css';
import { SeatGrid } from './SeatGrid';

export function SetupPage({ view, refresh, onStarted, notice }: { view: TableView; refresh: () => void; onStarted: () => void; notice?: string | null }) {
  const user = useSession((state) => state.user);
  const isHost = user?.id === view.host_user_id;
  const [tiers, setTiers] = useState<AiTierInfo[]>([]);
  useEffect(() => { listAiTiers().then((result) => setTiers(result.tiers)).catch(() => setTiers([])); }, []);
  const [busySeat, setBusySeat] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let code: string | null = null;
  try { code = sessionStorage.getItem(`room:${view.id}`); } catch { /* ignore */ }
  const full = view.seats.every((seat) => seat.user_id !== null || seat.actor_type === 'ai');
  const empty = view.seats.filter((seat) => seat.user_id === null && seat.actor_type !== 'ai').length;
  const removeAi = async (seat: number) => {
    setBusySeat(seat); setError(null);
    try { await clearAiSeat(view.id, seat); refresh(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not remove the player.'); }
    finally { setBusySeat(null); }
  };
  const addAi = async (seat: number, tier: AiTier) => {
    setBusySeat(seat); setError(null);
    try { await fillAiSeat(view.id, seat, tier); refresh(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not add the player.'); }
    finally { setBusySeat(null); }
  };
  const start = async () => {
    setStarting(true); setError(null);
    try { await startTable(view.id); onStarted(); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not start the game.'); setStarting(false); }
  };
  return (
    <main className="setup">
      <header className="setup-header">
        <h1>Waiting room</h1>
        {code
          ? <div className="room-code">
            <span>Room code</span>
            <strong className="code">{code}</strong>
            <InviteButton code={code} />
          </div>
          : <p className="muted">Ask the host for the code.</p>}
        <p className="setup-shape">{view.seat_count} seats · {view.starting_chips.toLocaleString()} chips · {view.small_blind}/{view.big_blind} blinds</p>
      </header>
      {notice && <RecoveryNotice message={notice} />}
      <h2 className="setup-section">Players</h2>
      <SeatGrid seats={view.seats} isHost={isHost} hostUserId={view.host_user_id} busySeat={busySeat} tiers={tiers}
        onAddAi={addAi} onChangeAi={addAi} onRemoveAi={removeAi}
        onInvite={() => { if (code) void shareInvite(code); }} />
      {error && <p role="alert">{error}</p>}

      <div className="setup-commit">
        {!full && <p className="setup-waiting">{empty === 1 ? 'One seat still open.' : `${empty} seats still open.`} Invite someone, or sit a model there.</p>}
        {isHost
          ? <Button variant="primary" onClick={start} disabled={!full} busy={starting}>Start game</Button>
          : <p className="muted">Waiting for the host to start.</p>}
      </div>
    </main>
  );
}
