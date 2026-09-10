import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getHistory } from '../../api/history';
import { ApiError } from '../../api/http';
import type { PlayerHistory } from '../../domain/history';
import './history.css';

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString()}`;
const opponentLabel = (name: string) => (name === 'human' ? 'People' : `${name} house player`);

export function HistoryPage() {
  const [history, setHistory] = useState<PlayerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getHistory().then(setHistory).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load your record.'));
  }, []);

  if (error) return <main className="boot"><p role="alert">{error}</p><Link to="/">Back to lobby</Link></main>;
  if (!history) return <main className="boot" aria-busy="true"><p>Reading your record…</p></main>;

  const { hands, sessions, opponents, recent } = history;

  return (
    <main className="history">
      <header className="history-header">
        <h1>Your record</h1>
        <Link to="/">Back to lobby</Link>
      </header>

      {hands.played === 0 ? (
        <p className="history-empty">No finished hands yet. Play a table and your record will build itself.</p>
      ) : (
        <>
          <dl className="history-totals">
            <div className="history-total">
              <dt>Hands won</dt>
              <dd className="tabular">{hands.win_rate}%</dd>
              <small>{hands.won.toLocaleString()} of {hands.played.toLocaleString()} hands, {signed(hands.net_chips)} chips</small>
            </div>
            <div className="history-total">
              <dt>Tables won</dt>
              <dd className="tabular">{sessions.played === 0 ? '—' : `${sessions.win_rate}%`}</dd>
              <small>
                {sessions.played === 0
                  ? 'No table has finished yet'
                  : `${sessions.won} of ${sessions.played} finished tables`}
              </small>
            </div>
          </dl>

          <h2>Against each opponent</h2>
          <table className="record">
            <thead>
              <tr>
                <th scope="col">Opponent</th>
                <th scope="col" className="numeric">Hands</th>
                <th scope="col" className="numeric">Won</th>
                <th scope="col" className="numeric">Chips</th>
              </tr>
            </thead>
            <tbody>
              {opponents.map((row) => (
                <tr key={row.opponent}>
                  <td className="who">
                    {opponentLabel(row.opponent)}
                    {row.opponent !== 'human' && <small>{row.won} won, {row.hands - row.won} lost</small>}
                  </td>
                  <td className="numeric tabular">{row.hands.toLocaleString()}</td>
                  <td className="numeric">
                    <span className="rate">
                      <span className="rate-track" aria-hidden="true">
                        <span className="rate-bar" style={{ width: `${Math.min(100, row.win_rate)}%` }} />
                      </span>
                      <span className="rate-value tabular">{row.win_rate}%</span>
                    </span>
                  </td>
                  <td className="numeric tabular">{signed(row.net_chips)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {recent.length > 0 && (
            <>
              <h2>Recent hands</h2>
              <ul className="recent">
                {recent.map((hand, index) => (
                  <li key={`${hand.table_id}-${index}`}>
                    <span className="outcome" data-won={hand.won}>{hand.won ? 'Won' : 'Lost'}</span>
                    <span className="against">
                      against {hand.opponents.map(opponentLabel).join(' and ') || 'nobody'}
                      {hand.showdown ? ', to a showdown' : ''}
                    </span>
                    <span className="delta">{signed(hand.net_chips)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
