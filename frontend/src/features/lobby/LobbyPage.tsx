import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logout } from '../../api/auth';
import { useSession } from '../../store/session';
import { CreateTableForm } from './CreateTableForm';
import { JoinTableForm } from './JoinTableForm';
import { HowItWorks } from './HowItWorks';
import { PENDING_INVITE } from './JoinRoute';
import './lobby.css';

type Panel = 'join' | 'create' | 'how' | null;

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

      {/* What the table can be, before the question of how to get to one. */}
      <ul className="lobby-modes" aria-hidden="true">
        <li><span className="mode-chip">♣</span>Real hands</li>
        <li><span className="mode-chip">🤖</span>Play with LLMs</li>
        <li><span className="mode-chip">⚡</span>Fast and fun</li>
      </ul>

      {/* The room, out of focus: chips under the lamp. */}
      <div className="lobby-band" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
      </div>

      {/* Three ways in, in the order a person wants them: join a game, start
          one, or find out what this is. */}
      <nav className="lobby-choices" aria-label="Get started">
        <button type="button" className="choice choice-primary" aria-expanded={panel === 'join'} onClick={() => toggle('join')}>
          <span className="choice-icon" aria-hidden="true">▶</span>
          <span><b>Play now</b><small>Join a table with a room code</small></span>
        </button>
        <button type="button" className="choice" aria-expanded={panel === 'create'} onClick={() => toggle('create')}>
          <span className="choice-icon" aria-hidden="true">＋</span>
          <span><b>Create a table</b><small>Invite friends or house players</small></span>
        </button>
        <button type="button" className="choice" aria-expanded={panel === 'how'} onClick={() => toggle('how')}>
          <span className="choice-icon" aria-hidden="true">?</span>
          <span><b>How it works</b><small>The rules, and what beats what</small></span>
        </button>
      </nav>

      <section className="lobby-panel">
        {panel === 'join' && <JoinTableForm />}
        {panel === 'create' && <CreateTableForm />}
        {panel === 'how' && <HowItWorks />}
      </section>

      <p className="lobby-motto">"Same game. Different minds."</p>

      <footer className="lobby-foot">
        <p>Signed in as {user?.display_name}</p>
        <Link to="/history">Your record</Link>
        <button type="button" className="btn-link" onClick={signOut} disabled={signingOut}>Sign out</button>
      </footer>
    </main>
  );
}
