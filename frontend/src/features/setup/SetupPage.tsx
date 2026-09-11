import { useEffect, useState } from 'react';
import type { AiTier, AiTierInfo, TableView } from '../../domain/table';
import { fillAiSeat, startTable } from '../../api/tables';
import { listAiTiers } from '../../api/ai';
import { ApiError } from '../../api/http';
import { useSession } from '../../store/session';
import { Button } from '../../components/Button';
import { InviteButton } from './InviteButton';
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
      <SeatGrid seats={view.seats} isHost={isHost} busySeat={busySeat} tiers={tiers} onAddAi={addAi} />
      {error && <p role="alert">{error}</p>}
      {isHost ? <Button variant="primary" onClick={start} disabled={!full} busy={starting}>Start game</Button> : <p className="muted">Waiting for the host to start.</p>}
    </main>
  );
}
