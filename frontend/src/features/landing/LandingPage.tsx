import { loginUrl } from '../../api/auth';

export function LandingPage({ error }: { error?: string }) {
  return (
    <main className="landing">
      <h1>The Common Table</h1>
      <p>A private table for friends. Play money, real company.</p>
      {error && <p role="alert">{error}</p>}
      <a className="btn btn-primary" href={loginUrl()}>Sign in with Google</a>
    </main>
  );
}
