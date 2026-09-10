import { Link } from 'react-router-dom';
import type { FinalRanking, TableStatus } from '../../domain/table';

export function SessionEnded({ status, rankings }: { status: Extract<TableStatus, 'ended' | 'cancelled'>; rankings: FinalRanking[] }) {
  return <main className="session-ended">
    <h1>{status === 'ended' ? 'Final standings' : 'Table closed'}</h1>
    {status === 'cancelled' && <p>Every player left, so this table was closed.</p>}
    {status === 'ended' && <ol>{rankings.map((ranking, index) => <li key={ranking.seat_number}><span>{index + 1}.</span> <span>{ranking.display_name ?? `Seat ${ranking.seat_number}`}</span> <span className="tabular">{ranking.chip_count.toLocaleString()}</span></li>)}</ol>}
    <Link className="btn btn-primary" to="/">Back to lobby</Link>
  </main>;
}
