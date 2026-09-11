import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Button } from '../../components/Button';
import './lobby.css';

type Seats = 2 | 3 | 4;
type Chips = 1000 | 5000 | 10000;
type Blind = 5 | 10 | 25;

/** Setting up a table, on a screen of its own.
 *
 *  This used to unfold under the home screen as a form of dropdowns, which
 *  made starting a game feel like changing a setting. Three choices, none of
 *  them with more than four options, so none of them need a menu. */
export function CreateTablePage() {
  const navigate = useNavigate();
  const [seats, setSeats] = useState<Seats>(2);
  const [chips, setChips] = useState<Chips>(1000);
  const [smallBlind, setSmallBlind] = useState<Blind>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const table = await createTable({ seat_count: seats, starting_chips: chips, small_blind: smallBlind, big_blind: smallBlind * 2 });
      if (table.room_code) { try { sessionStorage.setItem(`room:${table.id}`, table.room_code); } catch { /* private mode */ } }
      navigate(`/tables/${table.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the table.');
      setBusy(false);
    }
  };

  return (
    <main className="step">
      <header className="step-header">
        <button type="button" className="step-back" aria-label="Back" onClick={() => navigate('/')}>←</button>
        <h1>Create private table</h1>
      </header>

      <p className="step-lede">Pick the shape of the game. These lock when the first hand is dealt.</p>

      <Choice<Seats> label="Seats" value={seats} onChange={setSeats}
        options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} />
      <Choice<Chips> label="Starting chips" value={chips} onChange={setChips}
        options={[{ value: 1000, label: '1,000' }, { value: 5000, label: '5,000' }, { value: 10000, label: '10,000' }]} />
      <Choice<Blind> label="Blinds" value={smallBlind} onChange={setSmallBlind}
        options={[{ value: 5, label: '5 / 10' }, { value: 10, label: '10 / 20' }, { value: 25, label: '25 / 50' }]} />

      {error && <p role="alert" className="step-error">{error}</p>}

      <div className="step-commit">
        <p className="step-summary">{seats} seats · {chips.toLocaleString()} chips · {smallBlind}/{smallBlind * 2} blinds</p>
        <Button variant="primary" busy={busy} onClick={create}>Create table</Button>
      </div>
    </main>
  );
}

function Choice<T extends number>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <section className="choice-group" role="group" aria-label={label}>
      <h2>{label}</h2>
      <div className="segments">
        {options.map((option) => (
          <button key={option.value} type="button" className="segment" aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </section>
  );
}
