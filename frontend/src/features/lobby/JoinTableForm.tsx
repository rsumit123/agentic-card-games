import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';

export function JoinTableForm() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { const table = await joinTable(code.trim()); navigate(`/tables/${table.id}`); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not join the table.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} aria-label="Join table">
      <h2 id="join-heading">Join with a room code</h2>
      <Field id="code" label="Room code" hint="Ask the host for the code.">
        <input id="code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" className="code-input" required />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary" busy={busy}>Join with code</Button>
    </form>
  );
}
