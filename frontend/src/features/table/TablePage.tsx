import type { TableView } from '../../domain/table';

export function TablePage({ view }: { view: TableView }) {
  return <p>Table {view.id}</p>;
}
