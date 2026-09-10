# Mobile gameplay audit: closing the gap with top poker apps

**Scope:** the gameplay screen only, portrait phone, 2-4 seats, private play-money table with friends and LLM house players. Landscape is out of scope. No tournaments, rebuys, public tables or leaderboards.

**Method:** measured captures on a real 412x839 portrait viewport using new multi-seat fixtures, plus three parallel audits (competitor patterns, state coverage, ergonomics and accessibility).

---

## 1. Current state, measured

New audit-only fixtures (`frontend/src/mocks/scenarios.ts`, driven by `?scenario=`) reach states nobody had ever seen, because every test and mock to date used two seats.

### The 4-seat table is broken

Viewport is 412 CSS px wide. At four seats the document itself measures **422px wide** because a `.seat-name` overflows, so the page scrolls sideways. All boxes below are CSS px in that 422px document; the felt occupies l=45 r=367 t=90 b=476.

| element | box | problem |
|---|---|---|
| seat 2 badge (left) | l=**-19** r=174 t=230 b=297 | starts 19px off the left edge of the screen; its card backs are half cut off |
| seat 4 badge (right) | l=263 r=**406** t=226 b=301 | overhangs the felt's right edge by 39px; the name truncates to "GPT-4o mi" |
| community cards | l=118 r=294 t=251 b=330 | seat 2 overlaps it by 56px, seat 4 by 31px. Both badges sit **on top of the flop** |
| seat 3 badge (top) | w=**58** | too narrow for a name |
| seat 1 badge (you) | b=**504** | 28px below the felt's bottom edge |

Root cause: `seatLayout.ts` places side seats at x=10/12 and x=88/90 percent of the felt, which was fine on a wide desktop felt but not on a felt that is 322px wide with 130-190px badges on it.

### Other measured facts

- **The showdown never reveals cards on the table.** Opponent seats still show card backs. The reveal exists only in a text panel below the felt, and at 3 seats that panel starts below the fold (page height 929 vs viewport 839).
- **The pot does not go anywhere.** At hand end the pot reads 0 and no chips travel to the winner. Chips only ever fly seat-to-pot.
- The winner is not highlighted on the felt at all.
- The result headline renders "You wins 1,480".
- **No thinking indicator for AI seats.** While an LLM decides, the action bar says only "Waiting for the table" and the seat is inert.
- The Gemini seat badge covers part of the pot number.
- Your own bet chip overlaps your hole cards.
- 70px of dead space sits between the felt and the action bar, and the bottom third of the screen is empty in the waiting state.
- "Leave table" and "End session" are on screen during every hand.
- **Raise control has no pot-fraction presets.** It is a number field, a bare range input, and two stacked buttons; "Back" falls below the fold.
- `index.html` has no `viewport-fit=cover`, and nothing in the CSS uses `env(safe-area-inset-*)`. A bottom action bar will sit under the home indicator.
- Layouts use `100vh`, not `dvh`/`svh`, so they break when the URL bar shows and hides.
- No sound, no `navigator.vibrate`, anywhere in `src/`.
- No `aria-live` announcement of turn changes. The only live regions are the host line and, set to `off`, the deadline ring.
- `prefers-reduced-motion` is globally honoured in `src/styles/base.css`.

### From the all-in / side-pot capture

- Two players are all in for different amounts, but the table shows a single pot number. There is no main-pot / side-pot breakdown anywhere.
- The pot figure is partially hidden behind the left seat badge in every 3- and 4-seat capture.
- Bet chips sit on top of the community cards.
- "all in" wraps onto two lines inside a narrow badge.
- "Call 700" and "All-in 700" are both offered and are the same action, from a stack of exactly 700.

---

## 2. Findings

Merged from three parallel audits: competitor patterns in portrait private-table apps, a state-coverage walk of the client against the server protocol, and a mobile ergonomics and accessibility pass. Every P0 row has either a screenshot or a `file:line` behind it.

### P0 — fix before showing this to anyone on a phone (8 findings)

| # | finding | evidence | fix | side |
|---|---|---|---|---|
| 1 | **Three and four seats do not fit the felt.** Side badges hang off both edges of a 412px screen and, at four seats, paint on top of the community cards. | Captured: seat 2 at l=-19, seat 4 at r=406, both overlapping the board band 251..330. A `.seat-name` pushes the document to 422px, so the page scrolls sideways. | Two side badges plus a gutter must fit the felt's measured 322px, so each must be under ~136px. Today's minimum badge is 147px and the realistic one is 157px, so both fail. Moving the percentages alone cannot fix it: shrink the opponent badge to an avatar-first token, then move side slots to x≈21/79% and y≤32% so an active 91px badge clears the board top at y=179. | frontend |
| 2 | **Your own cards are too small to read.** A 36px card in a 100-unit viewBox renders the corner rank at **5.76px** and the corner suit at **4.68px**. Your hole cards at 56px render the rank at 8.96px. | `PlayingCard.css:2`, `PlayingCard.tsx:36,40` | Hole cards at 72px+, opponents at 48px+, or raise the viewBox font sizes so the rendered rank is at least 12px. | frontend |
| 3 | **Fold is 8px from Call with no confirmation, and All-in is one tap styled like Raise.** | `table.css:291` `gap: 8px`; `ActionBar.tsx:18,23` fire immediately. Note that "End session" *is* guarded (`LeaveEndControls.tsx:18-23`), so the pattern exists. | PokerStars hides Fold entirely when checking is free, and chose that over a warning dialog. GGPoker ships confirmation on all-ins and large bets. Do both: hide Fold when the call costs nothing, and confirm All-in. Separate Fold from Call by 24px or put it on its own row. | frontend |
| 4 | **No bet-size presets.** The raise control is a number field, a bare range input with no `step`, and two stacked buttons; "Back" falls below the fold. | Captured at 412x839. `RaiseControl.tsx` is 16 lines. Arrow-key traversal of a 20..1000 range takes hundreds of presses. | Every comparable offers presets first and the slider as an escape hatch: GGPoker ships 1/3, 1/2, 3/4 and pot; PokerBros and Pokerrrr 2 add plus/minus and typed entry. Presets are the feature. | frontend |
| 5 | **The showdown never reveals cards on the table.** Opponents still show card backs. The reveal exists only in a text panel that starts below the fold at three seats. | Captured: page height 929 vs viewport 839. | Flip the opponents' cards on the felt, highlight the five cards that won, and keep the result within the first screen. | frontend |
| 7 | **A signed-out or unseated player hits a dead end.** The socket closes 4401/4403 and the client returns without scheduling a retry, so the recovery panel never renders. | `TableSocket.ts:57-58`, `TablePage.tsx:57` | You get a pill and a permanent "Opening your seat…". Render the same recovery panel used for handshake failure: a sign-in link for 4401, back-to-lobby for 4403. | frontend |
| 8 | **No safe-area inset under the sticky action bar.** `index.html` has no `viewport-fit=cover` and nothing in the CSS uses `env(safe-area-inset-*)`. | `index.html:6`, `table.css:289` | The lower ~16px of the second button row sits inside the iOS home-indicator strip. Both the meta flag and the padding are needed; `env()` resolves to 0 without the meta. | frontend |
| 9 | **A turn change is never announced to a screen reader.** The status line is a plain `div`, and `aria-current` sits on a generic `div` where it is not exposed. | `ActionBar.tsx:13`, `SeatBadge.tsx:29` | `role="status"` on the action status; a real role on the seat badge. | frontend |

### P1 — the difference between playable and enjoyable

| # | finding | evidence | fix | side |
|---|---|---|---|---|
| 10 | **AI seats show no thinking state, and waiting on a human looks identical.** | `TablePage.tsx:46-48` | Say who you are waiting for by name, and show "thinking" for AI seats. On provider failure the player currently watches a 30s timer expire with no explanation. | frontend for the label, backend for the failure signal |
| 10b | **The all-in runout is a single frame.** The server deals flop, turn and river and resolves the showdown in one transition. | `engine.py:194-197,289` | The client already has every card. Stage the reveal 3 then 1 then 1 over about two seconds inside the existing six-second reveal window. The most dramatic moment in poker currently has no UI at all. | frontend |
| 11 | **The pot never moves to the winner.** Chips fly seat-to-pot only, and the pot reads 0 at hand end. | Captured. `ChipFlight.tsx:5` targets a hardcoded y=31 while `.pot` is at 34% on mobile, so chips also stop ~13px short. | Animate the pot to the winner. This is how a casual player reads the outcome without reading a number. | frontend |
| 12 | **Side pots are not representable.** The engine computes contribution layers but the projection exports a single scalar. | `engine.py:300-326`, `state.py:43-45`. Captured: two players all in for different amounts, one pot number. | With three or four players and any short stack this is wrong information, not merely missing. Export the layers. | **backend** |
| 13 | **The full action log is sent and never rendered.** | `engine.py:408`, `domain/game.ts:9` | You cannot tell what anyone did. A raise shows only as a changed stack. Render a three-line feed; the data is already in the projection. | frontend |
| 14 | **No street announcement and no deal animation.** `card-enter` exists in the CSS and is never applied. | `PlayingCard.css:5` | Label the flop, turn and river; animate only the newly dealt cards. | frontend |
| 15 | **The gap between hands is invisible.** The server holds the result for six seconds then silently swaps in a new hand. | `manager.py:280-281` | Send the reveal deadline and hand number; count down and play a deal beat. | backend |
| 16 | **A timeout auto-fold is silent.** The timer hits zero and the hand moves on. | `actor.py:139-160` | Mark timeout folds in the log so the client can say "time ran out". | backend |
| 17 | **Layout is keyed on players still in the hand, not seat count.** | `seatLayout.ts:12` | A four-handed table silently becomes a three-slot layout the hand after someone busts, and every badge jumps. | frontend |
| 18 | **Busting out reuses the word "Spectating" and hands your seat slot to a stranger.** When your seat is absent, `seatPositions` gives the hero slot to the lowest-numbered other player. | `seatLayout.ts:9-13`, `ActionBar.tsx:7` | A distinct "you're out" state, and keep the hero slot empty. | frontend |
| 19 | **The recovery notice hides the whole table and returns on every reconnect.** The server never clears the notice. | `TablePage.tsx:58`, `main.py:78-80` | Show it as a dismissible banner above the felt. | frontend for the banner, backend to clear it |
| 20 | **"Reconnecting…" forever, with no retry and no liveness check.** Backoff is unbounded and the status never escalates; a silently dead server still reads "Connected". | `TableSocket.ts:59-74` | Cap visible retries then offer Retry. If the deadline passes by ~5s with no event, resync. | frontend |
| 21 | **No sound and no haptics anywhere.** | grep across `src/` returns nothing | GGPoker frames action sounds as *the* turn cue, and Zynga exposes sound and vibration toggles. Two web constraints: `navigator.vibrate` does not exist on iOS Safari, so haptics cannot be the turn cue; and audio must be armed on the first user gesture. Sound is the only cross-platform channel. | frontend |
| 21b | **The turn clock is easy to miss, and there is no clock where your thumb is.** At 3 seconds left the only urgency cue is a red sliver on a 4px bar and a small "3s" at the bottom of your own badge. At three and four seats that badge may be off-screen. `DeadlineRing` exists but has zero importers and no CSS. | Captured at 3s remaining. `ActionBar.tsx:9,13` accepts a `deadline` node; `TablePage.tsx:62` never passes it. | The nearest comparables treat this as first-order: PokerStars players single out the missing visual countdown as their bigger complaint. Wire the ring into the action bar and make the last five seconds unmistakable. | frontend |
| 22 | **Pull-to-refresh can reload the page mid-hand.** No `overscroll-behavior` anywhere. | grep across `src/` | `overscroll-behavior-y: contain`. | frontend |
| 23 | **Focus is dropped after every action.** The pressed button becomes `disabled`, leaves the tab order, and focus falls to `body`. | `ActionBar.tsx:11` | Use `aria-disabled`, or move focus to the status line. | frontend |
| 24 | **Sit-out does not exist.** | — | PokerBros keeps sit-out and top-up in a session menu. Someone always has to answer the door; without it the alternative is repeated timeouts. | **backend** |
| 25 | **No invite/share affordance.** The room code is text to retype. | — | Pokerrrr 2 and Zynga both share a link directly. This is the front door of the product. | frontend for the share sheet |
| 26 | **The felt is sized in `vh`, and layouts use `100vh`.** | `table.css:281`, `base.css:7` | `svh`/`dvh`, so the felt does not render oversized while the URL bar shows. | frontend |
| 27 | **Leaving mid-hand freezes the table for everyone else.** The leaver navigates away but the seat still owes an action. | `lifecycle.py:56-61` | Everyone waits out a 30s timeout with no indication why. Auto-fold on leave. | **backend** |

### P2 — worth doing, not urgent

Quiet buttons have no perceivable boundary (1.33:1 against the bar) and `.leave-end` buttons are 38px tall, under the 44px floor. Red card ink is 3.78:1 on ivory, failing AA at the current size. The folded-seat label is dimmed to 2.29:1 by a blanket `opacity: 0.45`. `hand_rank` is sent per seat and, by the earlier product decision not to show hand strength, should be stripped from the projection rather than rendered. The pot double-counts the current street's bets, reading 60 while two seats each show a 30 chip. `RaiseControl` stays open when your turn ends and can fire a stale action. Raw server strings, including `str(exc)` of SQLAlchemy errors, reach the player in a red alert. The result line says "You wins 1,480" and joins multiple winners' hand categories into one sentence. The engine offers both "Call 700" and "All-in 700" from a stack of exactly 700, which are the same action; dedupe client-side or in `legal_actions`. The action bar collapses off-turn so the felt jumps under your thumb. Cards are long-press-selectable. A dropped queued action is discarded silently. Players who left are listed as spectators forever. Host transfer is unannounced to sighted users. The session event is not sent on connect, so a fresh join has no spectator list. Everything is in `px` with `body { font-size: 16px }`, so iOS Dynamic Type does nothing and Android text scaling collides the badges with the board.

**Also:** `tests/e2e/play.spec.ts` has been failing since the "Add player" button was renamed to "Play with an LLM". Verified by stashing all local changes; the failure is pre-existing.

### Deliberately not doing

Drawn from the competitor research, these are patterns that suit a public grinding client and not a four-person private game.

- **No drag-to-bet gesture.** No comparable exposes one. Pokerrrr 2's gestures cover fold, check and call only, and reviewers report new players struggle with them on small screens. Sizing by flick can commit a stack.
- **No gesture-primary input at all.** A friends game has permanent beginners. Gestures can be a power-user layer on top of buttons, never the only layer.
- **No user-configurable bet presets.** PokerStars allows this on desktop and explicitly not on mobile. Ship fixed presets.
- **No mandatory card peek.** Pokerrrr 2 forces a sustained swipe to see your own hand. GGPoker's optional squeeze with an "Open" bypass is the version worth taking, if any.
- **No HUD, no multi-tabling, no time-bank cards, no all-in insurance, no EV cashout.** Variance machinery and monetisation for real money.
- **No progression scaffolding.** Ranks, missions, medals and daily chip gifts are retention machinery for a public app. A private room's retention mechanism is the group chat.
- **No hand-strength display for the human.** Previously declined.

---

## 3. Suggested sequence

Effort is rough engineering days.

**Phase 1 — make it correct on a phone (P0 1, 2, 8, 9; ~2 days).** This is a rebuild of the seat badge, not a percentage tweak: the arithmetic says no repositioning alone can fit today's badge. Rebuild the opponent seat as an avatar-first token under 150px, re-slot the side seats, key the layout on seat count rather than players in hand, enlarge the cards, add `viewport-fit=cover` with safe-area padding, and announce turn changes. This is the block that makes three and four seats usable at all. Nothing else should ship before it.

**Phase 2 — stop the misfires (P0 3, 4, 7; ~1.5 days).** Hide Fold when checking is free, confirm All-in, separate the destructive control, and rebuild the raise control around pot-fraction presets with the slider as a fallback. Fix the signed-out and unseated dead ends.

**Phase 3 — make the hand readable (P0 5; P1 10b, 11, 13, 14; ~2.5 days).** Reveal opponents' cards on the felt, highlight the winning five, stage the all-in runout, move the pot to the winner, label the streets, animate newly dealt cards, and render the action feed. All of this uses data the server already sends.

**Phase 4 — server-side gaps (P1 12, 15, 16, 24, 27; ~2 days backend plus 1 day client).** Export pot layers so side pots are representable, send the reveal deadline and hand number, mark timeout folds, add sit-out, and auto-fold a player who leaves mid-hand.

**Phase 5 — feel and resilience (P1 10, 17-23, 21b, 25, 26; ~2 days).** Thinking indicators named by seat, bust-out state, recovery banner instead of a blank table, reconnect ceiling and liveness check, sound armed on first tap with a toggle, overscroll containment, focus handling, share-invite, and `dvh`.

**Phase 6 — P2 sweep (~1.5 days).** Contrast and tap-target floors, `rem` sizing, dead code, copy fixes, and the stale e2e test.

Total is roughly 12 days. Phases 1 and 2 are the ones that close the gap a player would notice in the first minute.
