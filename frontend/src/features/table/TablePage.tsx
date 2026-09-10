import { useEffect, useState } from 'react';
import type { TableView } from '../../domain/table';
import { me, loginUrl } from '../../api/auth';
import { getTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { useTable } from '../../store/table';
import { useTableSocket } from './useTableSocket';
import { Felt } from './Felt';
import { ActionBar, type BarStatus } from './ActionBar';
import { ConnectionPill } from './ConnectionPill';
import { RecoveryNotice } from './RecoveryNotice';
import { HandResult } from './HandResult';
import { SessionLine } from './SessionLine';
import { useSession } from '../../store/session';
import { LeaveEndControls } from './LeaveEndControls';
import { SessionEnded } from './SessionEnded';
import { DeadlineRing } from './DeadlineRing';
import { ActionFeed } from './ActionFeed';
import { NextHand } from './NextHand';
import { useTableSound } from './useTableSound';
import { SoundToggle } from './SoundToggle';

/** Engine and database text is written for a log, not for a player. */
const ERROR_TEXT: Record<string, string> = {
  invalid_action: 'That move is no longer available. The table has moved on.',
  invalid_command: 'The table did not understand that. Try again.',
  persistence_failed: 'The table could not save that action. It will retry.',
};
function errorText(error: { code: string; message: string }) {
  return ERROR_TEXT[error.code] ?? error.message;
}

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

export function TablePage({ view, onLeft = () => window.location.assign('/') }: { view: TableView; onLeft?: () => void }) {
  const { send, reconnect } = useTableSocket(view.id);
  const { projection, deadline, revealDeadline, connection, pending, lastError, needsResync, recoveryNotice, dismissNotice, droppedAction, setDroppedAction, canAct, session } = useTable();
  const myUserId = useSession((state) => state.user?.id ?? null);
  const hostId = session?.host_user_id ?? view.host_user_id;
  const hostSeat = view.seats.find((seat) => seat.user_id === hostId)?.seat_number ?? null;
  const meSpectating = !!session?.seats.find((seat) => seat.seat_number === projection?.seat_id)?.spectating
    || (!!projection && !projection.public.players.some((player) => player.seat_id === projection.seat_id));
  const spectators = session?.seats.filter((seat) => seat.spectating && seat.display_name) ?? [];
  // A seat with no chips left is out of the game, which is not the same thing
  // as choosing to watch.
  const myPlayer = projection?.public.players.find((player) => player.seat_id === projection.seat_id);
  const busted = !!projection && !myPlayer && (session?.seats.find((seat) => seat.seat_number === projection.seat_id)?.chip_count ?? 1) === 0;
  const status: BarStatus = needsResync ? 'resyncing' : busted ? 'out' : meSpectating ? 'spectating' : pending ? 'submitting'
    : !projection ? 'waiting' : projection.public.street === 'complete' ? 'hand-complete'
    : projection.public.current_seat === projection.seat_id ? 'your-turn' : 'waiting';

  const seatsByNumber = new Map(view.seats.map((seat) => [seat.seat_number, seat]));
  const turnSeat = projection?.public.current_seat ?? null;
  const waitingFor = turnSeat !== null && turnSeat !== projection?.seat_id
    ? projection?.public.names[turnSeat] ?? `Seat ${turnSeat}`
    : null;
  // A house player deciding takes a couple of seconds. Without a cue that is
  // indistinguishable from a table that has stopped.
  const thinkingSeats = turnSeat !== null && seatsByNumber.get(turnSeat)?.actor_type === 'ai' ? [turnSeat] : [];
  const myTurn = status === 'your-turn';
  useTableSound({ myTurn, street: projection?.public.street ?? null, handComplete: projection?.public.street === 'complete', won: !!projection && projection.public.winners.includes(projection.seat_id) });
  return <main className="table-page">
    <header className="table-header">
      <h1>The Common Table</h1>
      <p className="table-blinds">{view.small_blind}/{view.big_blind}</p>
      <SessionLine hostUserId={hostId} hostSeatNumber={hostSeat} seats={session?.seats ?? []} myUserId={myUserId} />
      <SoundToggle />
      <ConnectionPill status={connection} />
    </header>

    {connection === 'handshake_failed' && <HandshakeHelp tableId={view.id} reconnect={reconnect} />}
    {connection === 'unauthorized' && <div role="alert" className="recovery">
      <p>You were signed out.</p><a className="btn btn-primary" href={loginUrl()}>Sign in again</a>
    </div>}
    {connection === 'forbidden' && <div role="alert" className="recovery">
      <p>You are not seated at this table.</p><a className="btn btn-primary" href="/">Back to lobby</a>
    </div>}
    {connection === 'lost' && <div role="alert" className="recovery">
      <p>Lost the table. It may have gone away, or your connection did.</p>
      <button type="button" className="btn btn-primary" onClick={reconnect}>Try again</button>
    </div>}
    {droppedAction && <div role="alert" className="recovery recovery-inline">
      <p>Your last move did not reach the table. Have another go.</p>
      <button type="button" className="btn" onClick={() => setDroppedAction(false)}>OK</button>
    </div>}
    {session?.status === 'ended' || session?.status === 'cancelled' ? <SessionEnded status={session.status} rankings={session.final_rankings} /> : !projection ? <p aria-busy="true">Opening your seat…</p> : <>
      {recoveryNotice && <RecoveryNotice message={recoveryNotice} onDismiss={dismissNotice} />}
      <Felt projection={projection} deadline={deadline} seatCount={view.seat_count} thinkingSeats={thinkingSeats} />
      <HandResult pub={projection.public} mySeat={projection.seat_id} />
      <NextHand deadline={revealDeadline} />
      <ActionFeed pub={projection.public} mySeat={projection.seat_id} />
      {spectators.length > 0 && <ul className="spectators" aria-label="Spectators">{spectators.map((seat) => <li key={seat.seat_number}>{seat.display_name} · spectating</li>)}</ul>}
      <ActionBar legal={projection.legal_actions} canAct={canAct()} onAct={send} status={status}
        pot={projection.public.pot} bigBlind={projection.public.big_blind} waitingFor={waitingFor}
        deadline={myTurn ? <DeadlineRing deadline={deadline} /> : null}
        error={lastError && lastError.code !== 'stale_revision' ? errorText(lastError) : null} />
      {/* Leaving and ending are rare, so they sit past the action bar rather than
          crowding the header above the table. */}
      <details className="table-footer">
        <summary>Table options</summary>
        <SessionLine hostUserId={hostId} hostSeatNumber={hostSeat} seats={session?.seats ?? []} myUserId={myUserId} />
        <LeaveEndControls tableId={view.id} isHost={myUserId === hostId} handInProgress={projection.public.street !== 'complete'} onLeft={onLeft} />
      </details>
    </>}
  </main>;
}
