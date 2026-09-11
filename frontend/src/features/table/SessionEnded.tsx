import { Link } from 'react-router-dom';
import type { FinalRanking, TableStatus } from '../../domain/table';
import './table.css';

/** The end of a session, which is the one thing at this table worth stopping
 *  the game for. A single pot resolves on the felt; winning the table gets the
 *  crown. */
export function SessionEnded({ status, rankings, mySeat }: {
  status: Extract<TableStatus, 'ended' | 'cancelled'>;
  rankings: FinalRanking[];
  mySeat?: number;
}) {
  const iWon = status === 'ended' && rankings.length > 0 && rankings[0].seat_number === mySeat;
  return <main className={`session-ended ${iWon ? 'session-won' : ''}`}>
    {iWon && <Confetti />}
    {iWon && <span className="hand-result-crown" aria-hidden="true">♛</span>}
    <h1>{iWon ? 'You win the table' : status === 'ended' ? 'Final standings' : 'Table closed'}</h1>
    {status === 'cancelled' && <p>Every player left, so this table was closed.</p>}
    {status === 'ended' && <ol>{rankings.map((ranking, index) => <li key={ranking.seat_number}><span>{index + 1}.</span> <span>{ranking.display_name ?? `Seat ${ranking.seat_number}`}</span> <span className="tabular">{ranking.chip_count.toLocaleString()}</span></li>)}</ol>}
    <Link className="btn btn-primary" to="/">Back to lobby</Link>
  </main>;
}

/** Paper, for the one result that earns it. */
function Confetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  return <div className="confetti" aria-hidden="true">
    {Array.from({ length: 14 }, (_, index) => <i key={index} style={{ left: `${(index * 7 + 4) % 100}%`, animationDelay: `${(index % 5) * 0.18}s` }} />)}
  </div>;
}
