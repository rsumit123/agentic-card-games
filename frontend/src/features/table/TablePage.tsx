import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TableView } from '../../domain/table';
import { me, loginUrl } from '../../api/auth';
import { getTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { useTable } from '../../store/table';
import { useTableSocket } from './useTableSocket';
import { Felt } from './Felt';
import { ActionBar, type BarStatus } from './ActionBar';
import { DeadlineRing } from './DeadlineRing';
import { ConnectionPill } from './ConnectionPill';
import { RecoveryNotice } from './RecoveryNotice';
import { HandResult } from './HandResult';
import { SessionLine } from './SessionLine';
import { useSession } from '../../store/session';
import { LeaveEndControls } from './LeaveEndControls';

function HandshakeHelp({ tableId, reconnect }: { tableId: number; reconnect: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([me(), getTable(tableId)]).then(([session, table]) => {
      if (!active) return;
      if (!table.seats.some((seat) => seat.user_id === session.user.id)) setMessage('You are not seated at this table.');
    }).catch((caught) => {
      if (!active) return;
      if (caught instanceof ApiError && caught.code === 'unauthenticated') setMessage('You were signed out. Sign in again.');
      else if (caught instanceof ApiError && caught.code === 'forbidden') setMessage('You are not seated at this table.');
      else setMessage('The table server refused the connection. Try again.');
    });
    return () => { active = false; };
  }, [tableId]);
  if (!message) return null;
  return <div role="alert"><p>{message}</p>{message.includes('signed out') ? <a href={loginUrl()}>Sign in again</a> : message.includes('not seated') ? <a href="/">Back to lobby</a> : <button onClick={reconnect}>Retry</button>}</div>;
}

export function TablePage({ view }: { view: TableView }) {
  const navigate = useNavigate();
  const { send, reconnect } = useTableSocket(view.id);
  const { projection, deadline, connection, pending, lastError, needsResync, recoveryNotice, dismissNotice, canAct, session } = useTable();
  const myUserId = useSession((state) => state.user?.id ?? null);
  const hostId = session?.host_user_id ?? view.host_user_id;
  const hostSeat = view.seats.find((seat) => seat.user_id === hostId)?.seat_number ?? null;
  const meSpectating = !!session?.seats.find((seat) => seat.seat_number === projection?.seat_id)?.spectating
    || (!!projection && !projection.public.players.some((player) => player.seat_id === projection.seat_id));
  const spectators = session?.seats.filter((seat) => seat.spectating && seat.display_name) ?? [];
  const status: BarStatus = needsResync ? 'resyncing' : meSpectating ? 'spectating' : pending ? 'submitting'
    : !projection ? 'waiting' : projection.public.street === 'complete' ? 'hand-complete'
    : projection.public.current_seat === projection.seat_id ? 'your-turn' : 'waiting';
  return <main className="table-page">
    <header className="table-header">
      <h1>The Common Table</h1>
      <p>Private table · {view.seat_count} seats · blinds {view.small_blind}/{view.big_blind}</p>
      <SessionLine hostUserId={hostId} hostSeatNumber={hostSeat} seats={session?.seats ?? []} myUserId={myUserId} />
      <ConnectionPill status={connection} />
      <LeaveEndControls tableId={view.id} isHost={myUserId === hostId} handInProgress={projection ? projection.public.street !== 'complete' : true} onLeft={() => navigate('/')} />
    </header>
    {recoveryNotice && <RecoveryNotice message={recoveryNotice} onDismiss={dismissNotice} />}
    {connection === 'handshake_failed' && <HandshakeHelp tableId={view.id} reconnect={reconnect} />}
    {!projection ? <p aria-busy="true">Opening your seat…</p> : !recoveryNotice && <>
      <Felt projection={projection} />
      <HandResult pub={projection.public} />
      {spectators.length > 0 && <ul className="spectators" aria-label="Spectators">{spectators.map((seat) => <li key={seat.seat_number}>{seat.display_name} · spectating</li>)}</ul>}
      <ActionBar legal={projection.legal_actions} canAct={canAct()} onAct={send} status={status}
        error={lastError && lastError.code !== 'stale_revision' ? lastError.message : null}
        deadline={!meSpectating && projection.public.current_seat === projection.seat_id ? <DeadlineRing deadline={deadline} /> : null} />
    </>}
  </main>;
}
