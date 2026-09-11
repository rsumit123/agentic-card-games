import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../../api/auth';
import { useSession } from '../../store/session';
import { JoinTableForm } from './JoinTableForm';
import { HowItWorks } from './HowItWorks';
import { PENDING_INVITE } from './JoinRoute';
import './lobby.css';

type Panel = 'join' | 'how' | null;

export function LobbyPage() {
  const user = useSession((state) => state.user);
  const setAnonymous = useSession((state) => state.setAnonymous);
  const [signingOut, setSigningOut] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
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
    try { await logout(); }
    catch { /* the session is going away locally either way */ }
    finally { setAnonymous(); }
  };

  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));

  return (
    <main className="lobby">
      <header className="lobby-header">
        <div className="lobby-title">
          <span className="lobby-mark" aria-hidden="true">♠</span>
          <h1>The Common Table</h1>
        </div>
        <p className="lobby-tagline">Play poker with people and with language models.</p>
      </header>

      {/* The room, out of focus, with the promise on top of it: the band was a
          blur with nothing to say, taking the best space on the screen. */}
      <div className="lobby-band">
        <span aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>
        <p>People and language models.<br />Same table.</p>
      </div>

      {/* Three ways in, in the order a person wants them: join a game, start
          one, or find out what this is. */}
      <nav className="lobby-choices" aria-label="Get started">
        <button type="button" className="choice choice-primary" aria-expanded={panel === 'join'} onClick={() => toggle('join')}>
          <span className="choice-icon" aria-hidden="true">▶</span>
          <span><b>Play now</b><small>Join a table with a room code</small></span>
        </button>
        <Link to="/create" className="choice">
          <span className="choice-icon" aria-hidden="true">＋</span>
          <span><b>Create a table</b><small>Invite friends or house players</small></span>
        </Link>
      </nav>

      <section className="lobby-panel">
        {panel === 'join' && <JoinTableForm />}
        {panel === 'how' && <HowItWorks />}
      </section>

      {/* Reading the rules is not one of the two things to do here. */}
      <button type="button" className="btn-link lobby-how" aria-expanded={panel === 'how'} onClick={() => toggle('how')}>
        How it works
      </button>

      <footer className="lobby-foot">
        <span className="lobby-you" aria-hidden="true">{(user?.display_name ?? '?').slice(0, 1).toUpperCase()}</span>
        <p>{user?.display_name}</p>
        <Link to="/history">Your record</Link>
        <button type="button" className="btn-link" onClick={signOut} disabled={signingOut}>Sign out</button>
      </footer>
    </main>
  );
}
