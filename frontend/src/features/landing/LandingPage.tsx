import { loginUrl } from '../../api/auth';
import { PlayingCard } from '../../components/PlayingCard';
import type { Card } from '../../domain/cards';
import './landing.css';

/* Broadway, dealt across the felt. Decorative: the page states its case in words. */
const HERO_HAND: Card[] = [
  { rank: 10, suit: 'spades' },
  { rank: 11, suit: 'clubs' },
  { rank: 12, suit: 'diamonds' },
  { rank: 13, suit: 'hearts' },
  { rank: 14, suit: 'spades' },
];

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l6.9 5.3c4.1-3.8 6.6-9.3 6.6-14.9z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.500-9.1l-7.1 5.5C8 40.6 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10z" />
      <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8 7.4 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
    </svg>
  );
}

export function LandingPage({ error }: { error?: string }) {
  return (
    <main className="landing">
      <div className="landing-copy">
        <h1>The Common Table</h1>
        <hr className="rule" />
        <p className="landing-lede">A private table for friends. Play money, good company.</p>
        {error && <p role="alert" className="landing-alert">{error}</p>}
        <a className="btn btn-primary" href={loginUrl()}>
          <GoogleMark />
          Sign in with Google
        </a>
        <ul className="landing-facts">
          <li><span aria-hidden="true">{'\u2660\uFE0E'}</span>Private rooms, opened with a short code you share yourself.</li>
          <li><span aria-hidden="true" className="suit-red">{'\u2665\uFE0E'}</span>Two to four seats, filled by friends or by house players.</li>
          <li><span aria-hidden="true">{'\u2663\uFE0E'}</span>The server deals every hand, so nobody can see your cards.</li>
        </ul>
      </div>

      <div className="hero-table" aria-hidden="true">
        <div className="hero-felt">
          <p className="hero-plaque">PLAY MONEY<br />GOOD COMPANY</p>
          <div className="hero-fan">
            {HERO_HAND.map((card) => (
              <span className="hero-card" key={`${card.rank}${card.suit}`}>
                <PlayingCard card={card} size="lg" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
