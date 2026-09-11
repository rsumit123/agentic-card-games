import type { Card } from '../domain/cards';
import { cardLabel, isRed, rankIndex } from '../domain/cards';
import './PlayingCard.css';

const GLYPH = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const;
const PIPS: Record<number, [number, number][]> = {
  2: [[50, 30], [50, 110]], 3: [[50, 30], [50, 70], [50, 110]],
  4: [[32, 30], [68, 30], [32, 110], [68, 110]], 5: [[32, 30], [68, 30], [50, 70], [32, 110], [68, 110]],
  6: [[32, 30], [68, 30], [32, 70], [68, 70], [32, 110], [68, 110]],
  7: [[32, 30], [68, 30], [50, 50], [32, 70], [68, 70], [32, 110], [68, 110]],
  8: [[32, 30], [68, 30], [50, 50], [32, 70], [68, 70], [50, 90], [32, 110], [68, 110]],
  9: [[32, 26], [68, 26], [32, 55], [68, 55], [50, 70], [32, 85], [68, 85], [32, 114], [68, 114]],
  10: [[32, 26], [68, 26], [50, 40], [32, 55], [68, 55], [32, 85], [68, 85], [50, 100], [32, 114], [68, 114]],
  14: [[50, 70]],
};

type Common = { size?: 'sm' | 'md' | 'lg'; enter?: boolean; highlight?: boolean; delayMs?: number };
type Props = (Common & { card: Card; back?: false }) | (Common & { back: true; card?: undefined });

export function PlayingCard(props: Props) {
  const size = props.size ?? 'md';
  const extra = `${props.enter ? ' card-enter' : ''}${props.highlight ? ' card-win' : ''}`;
  // Cards dealt together are staggered, so a flop reads as three cards landing
  // rather than one block of three.
  const style = props.delayMs ? { animationDelay: `${props.delayMs}ms` } : undefined;
  if (props.back) {
    return <svg className={`card card-${size} card-back${extra}`} style={style} viewBox="0 0 100 140" role="img" aria-label="Face-down card">
      <rect x="1" y="1" width="98" height="138" rx="6" fill="var(--ivory)" stroke="var(--ink)" strokeOpacity="0.2" />
      <rect x="7" y="7" width="86" height="126" rx="4" fill="var(--felt-deep)" />
      <path d="M50 40c-14 10-14 40 0 60c14-20 14-50 0-60z" fill="none" stroke="var(--brass)" strokeWidth="1.5" />
    </svg>;
  }
  const { card } = props;
  const red = isRed(card.suit);
  const glyph = GLYPH[card.suit];
  const index = rankIndex(card.rank);
  const court = card.rank >= 11 && card.rank <= 13;
  return <svg className={`card card-${size}${extra}`} style={style} viewBox="0 0 100 140" role="img" aria-label={cardLabel(card)} data-color={red ? 'red' : 'black'}>
    <rect x="1" y="1" width="98" height="138" rx="6" fill="var(--ivory)" stroke="var(--ink)" strokeOpacity="0.2" />
    <g className="card-ink">
      <text x="8" y="24" fontSize="23" fontWeight="600">{index}</text><text x="8" y="43" fontSize="19">{glyph}</text>
      <g transform="rotate(180 50 70)"><text x="8" y="24" fontSize="23" fontWeight="600">{index}</text><text x="8" y="43" fontSize="19">{glyph}</text></g>
      {court ? <g data-pip><rect x="28" y="36" width="44" height="68" rx="4" fill="none" stroke="var(--copper)" strokeWidth="2" />
        <text x="50" y="82" fontSize="34" textAnchor="middle" fontFamily="var(--font-display)">{index}</text></g> : (PIPS[card.rank] ?? []).map(([x, y], i) =>
          <text key={i} data-pip x={x} y={y + 7} fontSize={card.rank === 14 ? 40 : 18} textAnchor="middle">{glyph}</text>)}
    </g>
  </svg>;
}
