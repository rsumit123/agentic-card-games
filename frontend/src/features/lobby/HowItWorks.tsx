const RANKINGS: [string, string][] = [
  ['Straight flush', 'Five in a row, all one suit'],
  ['Four of a kind', 'All four of the same rank'],
  ['Full house', 'Three of one rank, two of another'],
  ['Flush', 'Five of one suit, any order'],
  ['Straight', 'Five in a row, any suits'],
  ['Three of a kind', 'Three of the same rank'],
  ['Two pair', 'Two ranks paired'],
  ['One pair', 'Two of the same rank'],
  ['High card', 'None of the above'],
];

/** For the friend who was handed a link and has never played.
 *
 *  With house players at the table there is nobody to ask whether a flush
 *  beats a straight, so the answer lives in the app. */
export function HowItWorks() {
  return (
    <article className="panel how">
      <h2>How it works</h2>
      <p>Everyone gets two cards of their own. Five more are dealt face up in
        the middle, a few at a time, with a round of betting after each. The
        best five cards from those seven wins the chips in the middle.</p>
      <p>Empty seats can be filled by a language model. It sees exactly what
        you see: the cards on the table, the bets, and nothing of your hand.</p>
      <h3>What beats what</h3>
      <ol className="how-rankings">
        {RANKINGS.map(([name, gloss]) => (
          <li key={name}><b>{name}</b><span>{gloss}</span></li>
        ))}
      </ol>
      <p className="how-note">Play money only. Nothing here is worth anything.</p>
    </article>
  );
}
