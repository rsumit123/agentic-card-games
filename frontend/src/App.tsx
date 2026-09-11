import { useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { me } from './api/auth';
import { ApiError } from './api/http';
import { useSession } from './store/session';
import { LandingPage } from './features/landing/LandingPage';
import { LobbyPage } from './features/lobby/LobbyPage';
import { CreateTablePage } from './features/lobby/CreateTablePage';
import { TableRoute } from './features/table/TableRoute';
import { HistoryPage } from './features/history/HistoryPage';
import { JoinRoute, PENDING_INVITE } from './features/lobby/JoinRoute';

export default function App() {
  const { status, setAuthenticated, setAnonymous, setError } = useSession();
  const [params] = useSearchParams();
  // Signing in bounces through Google, so an invite code in the URL has to be
  // kept somewhere that survives the round trip.
  useEffect(() => {
    const invite = /^\/join\/([^/]+)/.exec(window.location.pathname)?.[1];
    if (invite) { try { sessionStorage.setItem(PENDING_INVITE, decodeURIComponent(invite)); } catch { /* private mode */ } }
  }, []);
  useEffect(() => {
    me().then((response) => setAuthenticated(response.user, response.csrf_token))
      .catch((error: ApiError) => (error.code === 'unauthenticated' ? setAnonymous() : setError()));
  }, [setAuthenticated, setAnonymous, setError]);
  if (status === 'loading') return <main className="boot" aria-busy="true"><h1>The Common Table</h1><p>Checking your session…</p></main>;
  if (status === 'error') return <LandingPage error="Could not reach the table server. Try again in a moment." />;
  if (status === 'anonymous') return <LandingPage error={params.get('error') ?? undefined} />;
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/create" element={<CreateTablePage />} />
      <Route path="/tables/:id" element={<TableRoute />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/join/:code" element={<JoinRoute />} />
      <Route path="/join" element={<JoinRoute />} />
    </Routes>
  );
}
