import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { joinTable } from '../../api/tables';
import { ApiError } from '../../api/http';

export const PENDING_INVITE = 'commontable.invite';

/** Someone tapped an invite link. Take them straight to the seat.
 *
 *  The code is stashed on the way past because signing in bounces through
 *  Google and would otherwise lose it. */
export function JoinRoute() {
  const navigate = useNavigate();
  const param = useParams().code ?? null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let code = param;
    if (!code) { try { code = sessionStorage.getItem(PENDING_INVITE); } catch { /* private mode */ } }
    if (!code) { navigate('/', { replace: true }); return; }
    try { sessionStorage.removeItem(PENDING_INVITE); } catch { /* private mode */ }
    let active = true;
    joinTable(code.trim().toUpperCase())
      .then((table) => { if (active) navigate(`/tables/${table.id}`, { replace: true }); })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : 'Could not join that table.'); });
    return () => { active = false; };
  }, [param, navigate]);

  if (error) return <main className="boot"><p role="alert">{error}</p><a className="btn" href="/">Back to lobby</a></main>;
  return <main className="boot" aria-busy="true"><p>Taking you to the table…</p></main>;
}
