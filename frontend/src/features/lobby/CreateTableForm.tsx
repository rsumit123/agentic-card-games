import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';

export function CreateTableForm() {
  const navigate = useNavigate();
  const [seats, setSeats] = useState<2 | 3 | 4>(2);
  const [chips, setChips] = useState<1000 | 5000 | 10000>(1000);
  const [smallBlind, setSmallBlind] = useState<5 | 10 | 25>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const table = await createTable({ seat_count: seats, starting_chips: chips, small_blind: smallBlind, big_blind: smallBlind * 2 });
      if (table.room_code) { try { sessionStorage.setItem(`room:${table.id}`, table.room_code); } catch { /* ignore */ } }
      navigate(`/tables/${table.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the table.');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} aria-labelledby="create-heading">
      <h2 id="create-heading">Create a private table</h2>
      <Field id="seats" label="Seats"><select id="seats" value={seats} onChange={(event) => setSeats(Number(event.target.value) as 2 | 3 | 4)}>{[2, 3, 4].map((number) => <option key={number} value={number}>{number}</option>)}</select></Field>
      <Field id="chips" label="Starting chips"><select id="chips" value={chips} onChange={(event) => setChips(Number(event.target.value) as 1000 | 5000 | 10000)}>{[1000, 5000, 10000].map((number) => <option key={number} value={number}>{number.toLocaleString()}</option>)}</select></Field>
      <Field id="blinds" label="Blinds"><select id="blinds" value={smallBlind} onChange={(event) => setSmallBlind(Number(event.target.value) as 5 | 10 | 25)}>{[5, 10, 25].map((number) => <option key={number} value={number}>{number} / {number * 2}</option>)}</select></Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary" busy={busy}>Create table</Button>
    </form>
  );
}
