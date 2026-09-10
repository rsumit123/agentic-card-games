import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import type { TableView } from '../../domain/table';
import { SetupPage } from '../setup/SetupPage';
import { TablePage } from './TablePage';

export function TableRoute() {
  const id = Number(useParams().id);
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    getTable(id).then(setView).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load the table.'));
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (view?.status !== 'lobby') return; const timer = setInterval(refresh, 2000); return () => clearInterval(timer); }, [view?.status, refresh]);
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!view) return <main aria-busy="true"><p>Loading table…</p></main>;
  if (view.status === 'lobby') return <SetupPage view={view} refresh={refresh} onStarted={refresh} />;
  return <TablePage view={view} />;
}
