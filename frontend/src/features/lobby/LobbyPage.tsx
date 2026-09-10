import { useSession } from '../../store/session';
import { CreateTableForm } from './CreateTableForm';
import { JoinTableForm } from './JoinTableForm';

export function LobbyPage() {
  const user = useSession((state) => state.user);
  return (
    <main className="lobby">
      <header><h1>The Common Table</h1><p>Signed in as {user?.display_name}</p></header>
      <section className="lobby-forms"><CreateTableForm /><JoinTableForm /></section>
    </main>
  );
}
