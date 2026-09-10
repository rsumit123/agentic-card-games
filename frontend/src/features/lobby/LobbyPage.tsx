import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../../api/auth';
import { useSession } from '../../store/session';
import { CreateTableForm } from './CreateTableForm';
import { JoinTableForm } from './JoinTableForm';
import { PENDING_INVITE } from './JoinRoute';
import './lobby.css';

export function LobbyPage() {
  const user = useSession((state) => state.user);
  const setAnonymous = useSession((state) => state.setAnonymous);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();

  // An invite tapped before signing in lands here afterwards. Carry on to the
  // table the player was actually asked to join.
  useEffect(() => {
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(PENDING_INVITE); } catch { /* private mode */ }
    if (pending) navigate('/join', { replace: true });
  }, [navigate]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      /* the session is going away locally either way */
    } finally {
      setAnonymous();
    }
  };

  return (
    <main className="lobby">
      <header className="lobby-header">
        <h1>The Common Table</h1>
        <div className="lobby-who">
          <p>Signed in as {user?.display_name}</p>
          <Link to="/history">Your record</Link>
          <button type="button" className="btn-link" onClick={signOut} disabled={signingOut}>
            Sign out
          </button>
        </div>
      </header>
      <section className="lobby-forms">
        <CreateTableForm />
        <JoinTableForm />
      </section>
    </main>
  );
}
