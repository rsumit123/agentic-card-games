import { useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { me } from './api/auth';
import { ApiError } from './api/http';
import { useSession } from './store/session';
import { LandingPage } from './features/landing/LandingPage';
import { LobbyPage } from './features/lobby/LobbyPage';
import { TableRoute } from './features/table/TableRoute';
import { HistoryPage } from './features/history/HistoryPage';

export default function App() {
  const { status, setAuthenticated, setAnonymous, setError } = useSession();
  const [params] = useSearchParams();
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
      <Route path="/tables/:id" element={<TableRoute />} />
      <Route path="/history" element={<HistoryPage />} />
    </Routes>
  );
}
