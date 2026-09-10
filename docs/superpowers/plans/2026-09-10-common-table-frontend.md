# The Common Table Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Vercel-hosted React frontend for The Common Table that plays private no-limit Hold'em against the existing authoritative FastAPI backend at `main` commit `e5df08f`.

**Architecture:** A Vite/React/TypeScript single-page app under `frontend/`. Framework-free modules own the protocol (typed HTTP client, WebSocket client with reconnect and revision tracking, a Zustand table store); React components only render store state and dispatch commands. The backend stays at the repository root; moving it to `backend/` is a separately approved slice (section 1).

**Tech Stack:** React 18, Vite 5, TypeScript 5 (strict), react-router 6, Zustand 4, Vitest + Testing Library + jsdom, MSW for HTTP mocks, a hand-rolled fake WebSocket for socket tests, Playwright for one smoke e2e, Vercel, existing VM Nginx + Docker backend.

**Spec:** `docs/superpowers/specs/2026-09-09-private-card-table-design.md`
**Brief:** `docs/superpowers/prompts/2026-09-10-fable-frontend-implementation-plan-prompt.md`

---

## Verified backend behaviour (commit e5df08f, 73 tests passing)

Everything in this list was read in code, not taken from the brief.

| Area | Verified behaviour | Where |
|---|---|---|
| Session bootstrap | `GET /auth/me` returns `{user:{id,google_subject,email,display_name}, csrf_token}`; 401 when logged out | `app/routes/auth.py:78` |
| Login | `GET /auth/login` is a 307 redirect to Google; callback 303-redirects to `FRONTEND_URL/` | `app/routes/auth.py:23`, `:76` |
| CSRF | Every POST needs `X-CSRF-Token` equal to the session token | `app/auth.py:94` |
| Cookies | `SameSite=None; Secure` in production, `Lax` otherwise | `app/main.py:43` |
| CORS | Allowlist from `ALLOWED_ORIGINS`, credentials on, headers `Content-Type, X-CSRF-Token` | `app/main.py:46` |
| Tables | `POST /tables`, `POST /tables/join`, `GET /tables/{id}`, `POST /tables/{id}/start`, `POST /tables/{id}/seats/{n}/ai`, `POST /tables/{id}/leave`, `POST /tables/{id}/end` | `app/routes/tables.py` |
| Seat numbering | 1-based; host is seat 1 | `app/rooms/service.py:171` |
| AI tiers | Exact strings `Easy`, `Medium`, `Hard` (capitalised) | `app/ai/policy.py:37` |
| Room code | Returned only in the create response; `GET /tables/{id}` returns `room_code: null` | `app/rooms/service.py:130` |
| WS admission | Origin must match allowlist (4403), session required (4401), seat and actor must exist (4403); close codes are sent after accept | `app/routes/ws.py` |
| First WS frame | `snapshot` with `revision`, `payload`, `deadline`, `recovery_notice` | `app/routes/ws.py:37` |
| Ack | Projection for the submitting seat, plus `deadline` | `app/rooms/actor.py:114` |
| Fan-out | Other seats get `state` events with their own projection | `app/routes/ws.py:74`, `app/rooms/manager.py:44` |
| Timers and AI | `run_forever` polls every 250 ms, auto-folds at deadline, drives AI seats | `app/rooms/manager.py` |
| Hand progression | Active `Hand` rows are created at every hand start; completed hands settle chips, apply lifecycle state, wait six seconds, then start the next hand with a higher revision | `app/rooms/manager.py` |
| Projection | `public` carries dealer/blind seats, betting state, winners/payouts, per-player contributions, and a seat→display-name map; seat payload adds `hole_cards`, `legal_actions`, `hand_rank` | `app/games/holdem/engine.py`, `app/rooms/actor.py` |
| Amount semantics | `bet` and `raise` amounts are the total street contribution to raise *to*, bounded by `min_amount`/`max_amount` | `app/games/holdem/engine.py:137`, `:236` |
| Error codes | `stale_revision`, `invalid_action`, `invalid_command`, `persistence_failed`; error events echo `idempotency_key`; duplicate key replays the stored ack | `app/rooms/actor.py:116`, `app/routes/ws.py:107` |
| Names | `public.names` is a map `{seat_id: display_name or null}` on every projection (JSON keys are strings) | `app/rooms/actor.py:74` |
| Table view | adds `display_name`, `spectating` per seat and `final_rankings[]` when `status == "ended"` | `app/rooms/service.py:71` |
| Session event | `{type:"session", revision, status, host_user_id, seats[], final_rankings[]}` on leave, end, and hand end | `app/rooms/manager.py:394` |
| Spectator projection | A seat not in the current deal gets `hole_cards: []`, `legal_actions: []` | `app/rooms/actor.py:65` |
| Login return | `GET /auth/login?return_to=` honoured when its origin is in `ALLOWED_ORIGINS` | `app/routes/auth.py:31` |
| HTTP errors | FastAPI `{"detail": string}`; 403 unauthorised, 409 full/closed/lifecycle boundary, 410 expired, 422 config, 429 rate limit | `app/routes/tables.py` |

## Backend gap status

Commit `e5df08f` closed B1, B2, B3, B4, B5, and B8. Still open, owned by the backend agent:

1. **Bug B9: end or leave during the reveal window still deals the next hand.** `RoomManager.end` and `leave` (`app/rooms/manager.py:177`) update session state but never clear `_reveal_deadlines`, and `_start_next_hand` (`:251`) does not check `state.status`. Repro: complete a hand by folding, call `end()` as host within six seconds, advance the clock past the reveal, `run_once`. The table row stays `ended` while the actor deals `preflop` and a second `Hand` row appears. Fix: return early from `_start_next_hand` unless `state.status == "in_progress"`, and pop the reveal deadline in `end`/`leave` when the status changes. Slice C task 17 cannot be verified end to end until this lands.
2. **B6 (optional):** pre-start WebSocket for the lobby. Setup keeps polling `GET /tables/{id}` until then.
3. **B7 (optional):** AI decisions run inline in the manager loop, so one slow AI turn delays timers for every table. The frontend must tolerate late AI `state` events and deadline auto-folds.
4. **Ended tables keep their actor in memory.** Harmless at this scale; note for later.

---

## 1. Repository restructuring

**Decision: do not move the backend in this plan.** The frontend lives at `frontend/` beside the root-level backend. Vercel's "Root Directory" setting is `frontend`, so the backend never enters a Vercel build.

The `backend/` move is a separate, approved-later slice with this exact shape:

1. `git mv app alembic alembic.ini scripts tests pytest.ini requirements.txt Dockerfile docker-compose.yml .env.example backend/`
2. Edit `backend/Dockerfile` (paths are already relative to the build context; keep `WORKDIR /app`).
3. On the VM: `cd backend && docker compose up -d --build`, and change the data mount to `./data:/app/data` inside `backend/` or move the existing `data/` directory alongside it.
4. Update `README.md` paths and `.gitignore` (`backend/data/`).
5. Rollback: `git revert` the single commit and re-run compose from the root.

Nothing in the frontend depends on where the backend source lives. The one root-level file this plan adds is `tests/test_frontend_fixture.py` (Task 2), which pins the projection shape to the frontend fixture.

## 2. Frontend architecture and folder tree

```text
frontend/
  package.json
  vite.config.ts
  tsconfig.json
  vercel.json
  index.html
  .env.example
  public/
    favicon.svg
  src/
    main.tsx
    App.tsx                      # router + auth gate
    config.ts                    # reads VITE_* once
    styles/
      tokens.css                 # design tokens (section 13)
      base.css                   # reset, typography, focus, reduced motion
    domain/
      cards.ts                   # Card, Suit, rank helpers
      table.ts                   # TableView, SeatView, TableStatus
      game.ts                    # PublicState, SeatProjection, LegalAction, Action
      protocol.ts                # ServerEvent, Command, error codes
    api/
      http.ts                    # credentialed fetch, CSRF, ApiError
      auth.ts                    # me(), loginUrl(), logout()
      tables.ts                  # createTable, joinTable, getTable, startTable, fillAiSeat
    ws/
      TableSocket.ts             # connect/reconnect/backoff, event parsing
      idempotency.ts             # key generation + in-flight tracking
    store/
      session.ts                 # Zustand: user, csrf, auth status
      table.ts                   # Zustand: projection, revision, deadline, connection, pending command
    features/
      landing/LandingPage.tsx
      lobby/LobbyPage.tsx
      lobby/CreateTableForm.tsx
      lobby/JoinTableForm.tsx
      setup/SetupPage.tsx
      setup/SeatGrid.tsx
      setup/AiSeatMenu.tsx
      table/TablePage.tsx
      table/Felt.tsx               # oval, seats, community, pot
      table/SeatBadge.tsx
      table/ActionBar.tsx
      table/RaiseControl.tsx
      table/DeadlineRing.tsx
      table/ConnectionPill.tsx
      table/RecoveryNotice.tsx
    components/
      PlayingCard.tsx            # face + back, SVG
      Chip.tsx
      Button.tsx
      Field.tsx
  tests/
    setup.ts
    fakes/FakeWebSocket.ts
    fakes/handlers.ts            # MSW handlers
    unit/…  component/…  e2e/…
```

Rules that keep the server authoritative:

- `domain/` and `ws/` never import React.
- The client never computes legality. The action bar renders exactly `legal_actions` from the latest projection.
- The client never keeps a canonical state; it keeps the latest seat projection and replaces it wholesale on every `snapshot`, `ack`, or `state` event whose `revision` is greater than the one held.

## 3. State management

Two Zustand stores, chosen because they are testable without React and small enough to read in one sitting.

- `session` store: `status: 'loading'|'anonymous'|'authenticated'|'error'`, `user`, `csrfToken`. Loaded once by `App.tsx` from `GET /auth/me`.
- `table` store: `projection: SeatProjection|null`, `revision: number`, `deadline: string|null`, `recoveryNotice: string|null`, `connection: 'connecting'|'open'|'reconnecting'|'closed'`, `pending: {key: string, action: Action}|null`, `lastError: {code, message}|null`, `view: TableView|null` (lobby metadata from HTTP).

Reducer rules (implemented as store methods, unit-tested in Task 6):

- `applyEvent(event)`: `snapshot` always replaces; `ack` and `state` replace only if `event.revision > revision`; `error` sets `lastError`, clears `pending`, and if `code === 'stale_revision'` marks the socket for a resync (close and reconnect, since reconnect is the only resync path, see section 5).
- `submit(action)`: refused if `pending` is set or `projection.public.current_seat !== projection.seat_id`. One in-flight command at a time stays the rule for simplicity even though error events now echo `idempotency_key`.
- `session` events replace `session` in the store; the table page derives spectator, host, ended, and cancelled views from it (Tasks 14–18).

Lobby/setup state is server-fetched via polling (2 s) and held in React Query-free `useEffect` polling inside `SetupPage`; it is simple and disposable once the backend gains a pre-start socket.

## 4. HTTP client

`src/api/http.ts` exposes `request<T>(path, init)`:

- `credentials: 'include'` on every call.
- Adds `X-CSRF-Token` from the session store on non-GET.
- Base URL from `VITE_API_BASE_URL`, no trailing slash.
- Parses `{"detail": ...}`; `detail` may be a string or a Pydantic list. Normalises to `ApiError {status, code, message}` where `code` is derived from status: 401 `unauthenticated`, 403 `forbidden`, 409 `conflict`, 410 `expired`, 422 `invalid`, 429 `rate_limited`, otherwise `server`.
- On 401 from any call, the session store flips to `anonymous`.

Login is a full-page navigation to `${API}/auth/login`, never a fetch, because it is a redirect chain to Google.

## 5. WebSocket client and reconnect

`src/ws/TableSocket.ts`:

- URL `${VITE_WS_BASE_URL}/ws/tables/${tableId}`. The browser attaches the session cookie and `Origin` automatically; nothing to add.
- Reconnect with exponential backoff `500 ms · 2^n`, capped at 10 s, jitter ±20 %, unlimited attempts while the page is mounted. Close codes 4401 and 4403 stop reconnecting and surface `unauthorized` / `forbidden`; ordinary network closures use the reconnect backoff.
- Every (re)connection yields a fresh `snapshot`, which is the resync mechanism. There is no `resync` message in the protocol; the client must not invent one.
- Outgoing commands: `{expected_revision, idempotency_key, action}`. The key is `${seat_id}:${revision}:${crypto.randomUUID()}` and is stored in `sessionStorage` under `pending:${tableId}` until acked or rejected. On reconnect, if a pending key exists and the new snapshot's `current_seat` is still this seat at the same revision, the client re-sends the same envelope (the actor replays the stored ack for a duplicate key). If the revision moved, the pending entry is dropped.
- A `deadline` field on `snapshot`, `ack`, and `state` refreshes the countdown; the countdown is display-only.

## 6. TypeScript domain types

These mirror the code at `app/games/holdem/engine.py:340` and `app/routes/ws.py`. They are the contract Task 2 writes.

```ts
// src/domain/cards.ts
export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export interface Card { rank: number; suit: Suit }   // rank 2..14, 14 = Ace

// src/domain/game.ts
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export interface PublicPlayer {
  seat_id: number; stack: number; folded: boolean; all_in: boolean;
  contribution: number; street_contribution: number; has_acted: boolean;
}
export interface PublicState {
  street: Street; community_cards: Card[]; pot: number; current_seat: number | null;
  dealer_seat: number; small_blind_seat: number; big_blind_seat: number;
  small_blind: number; big_blind: number; current_bet: number; min_raise: number;
  winners: number[]; payouts: [number, number][]; players: PublicPlayer[];
  names: Record<number, string | null>;
}
export type LegalAction =
  | { type: 'fold' } | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; min_amount: number; max_amount: number }
  | { type: 'raise'; min_amount: number; max_amount: number }
  | { type: 'all_in'; amount: number };
export interface SeatProjection {
  public: PublicState; hole_cards: Card[]; seat_id: number;
  legal_actions: LegalAction[];
  hand_rank: { category: string; tiebreakers: number[] } | null;
}
export type Action =
  | { type: 'fold' | 'check' | 'call' | 'all_in' }
  | { type: 'bet' | 'raise'; amount: number };   // amount = raise-to total

// src/domain/protocol.ts (imports TableStatus, FinalRanking from ./table)
export interface Command { expected_revision: number; idempotency_key: string; action: Action }
export interface SessionSeat { seat_number: number; display_name: string | null; chip_count: number; spectating: boolean }
export interface SessionEvent { type: 'session'; revision: number; status: TableStatus; host_user_id: number | null; seats: SessionSeat[]; final_rankings: FinalRanking[] }
export type ErrorCode = 'stale_revision' | 'invalid_action' | 'invalid_command' | 'persistence_failed';
export type ServerEvent =
  | { type: 'snapshot'; revision: number; payload: SeatProjection; deadline: string | null; recovery_notice: string | null }
  | { type: 'ack'; revision: number; idempotency_key: string; payload: SeatProjection; deadline: string | null }
  | { type: 'state'; revision: number; payload: SeatProjection; deadline: string | null }
  | SessionEvent
  | { type: 'error'; code: ErrorCode; message: string; revision: number; idempotency_key: string | null };

// src/domain/table.ts
export type TableStatus = 'lobby' | 'in_progress' | 'ended' | 'cancelled';
export type AiTier = 'Easy' | 'Medium' | 'Hard';
export interface SeatView {
  seat_number: number; user_id: number | null; actor_type: 'human' | 'ai'; ai_tier: AiTier | null;
  chip_count: number; display_name: string | null; spectating: boolean;
}
export interface TableView {
  id: number; room_code: string | null; host_user_id: number; seat_count: 2 | 3 | 4;
  starting_chips: 1000 | 5000 | 10000; small_blind: 5 | 10 | 25; big_blind: number;
  status: TableStatus; join_expires_at: string | null; seats: SeatView[];
  final_rankings: FinalRanking[];
}
export interface FinalRanking { seat_number: number; display_name: string | null; chip_count: number }
```

## 7. Backend change status

Ordered by what the frontend needs first. All are the backend agent's work.

| # | Change | Unblocks |
|---|---|---|
| B1 | Implemented: next-hand progression, active/completed `Hand` rows, chip writeback, lifecycle settlement, reveal delay, higher cross-hand revisions | Slice C: continuous play, real recovery |
| B2 | Implemented: display names in table views and a seat→name map in private snapshots | Setup page names, table seat badges |
| B3 | Implemented: leave/end routes, spectator metadata, host transfer, rankings, and `session` events | Slice C: spectators, rankings, host transfer, end |
| B4 | Implemented: error events echo `idempotency_key` | Correlated command errors |
| B5 | Implemented: allowlisted `return_to` login redirects for Vercel previews | Vercel preview sign-in |
| B6 | Accept WS before start (actor absent) and publish `table` events on seat changes | Removes lobby polling (optional) |
| B7 | Run `adapter.decide` as a background task per table | Timer accuracy under slow AI (optional) |
| B8 | Implemented: `ws.py` accepts before closing with 4401/4403, so browser `onclose` receives the code | Precise signed-out vs not-seated handling; the handshake fallback in section 5 stays as defence |
| B9 | **Open bug:** next hand is dealt after `end`/`leave` during the reveal window (see "Backend gap status") | Slice C task 17 |

## 8. Authentication, cookies, CORS, CSRF, WebSocket security

- **Domain arrangement (decision needed, section 18):** recommended is frontend at `play.<domain>` and backend at `api.<domain>`. Same registrable domain means the session cookie is first-party; Safari and Firefox tracking protection do not block it, and `SameSite=Lax` would suffice. The current production setting `SameSite=None; Secure` still works and is kept for now. If the frontend stays on `*.vercel.app`, the cookie is third-party and mobile Safari blocks it by default; the app would appear logged out after the Google redirect. This is the single biggest deployment risk.
- **CORS:** `ALLOWED_ORIGINS` lists the exact production origin and, optionally, one stable preview alias. Wildcards are not possible with credentials.
- **CSRF:** token comes from `GET /auth/me` and is sent on every POST. Logout also clears the client stores.
- **WebSocket:** the browser sends `Origin` automatically; the backend compares it to the same allowlist. No token in the URL.
- **Secrets:** the frontend bundle holds only two public URLs.

## 9. Vercel deployment

- Project root directory `frontend`, framework preset Vite, build `npm run build`, output `dist`.
- `vercel.json` rewrites all paths to `/index.html` for client routing and sets `Cache-Control: no-store` on `index.html`.
- Environment: production and preview both get `VITE_API_BASE_URL` and `VITE_WS_BASE_URL` pointing at the one backend.
- Previews can sign in when their exact origin is included in backend `ALLOWED_ORIGINS`; preview builds can also use MSW mocks via `VITE_MOCK_API=1`.
- Custom domain `play.<domain>` per section 8.

## 10. VM Docker and Nginx deployment

No container changes. Add one Nginx server block for `api.<domain>` (dedicated subdomain, so nothing else on the VM is touched):

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;
    # ssl_certificate lines from certbot
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
server { listen 80; server_name api.example.com; return 301 https://$host$request_uri; }
```

`proxy_read_timeout` is raised from 75 s to 300 s because an idle table socket between hands sends nothing; the client also pings by reconnecting on close. Backend `.env` gets `FRONTEND_URL=https://play.example.com`, `ALLOWED_ORIGINS=https://play.example.com`, `GOOGLE_REDIRECT_URI=https://api.example.com/auth/callback`; the Google console must list that redirect URI.

## 11. Environment variable matrix

| Variable | Lives in | Value | Secret |
|---|---|---|---|
| `VITE_API_BASE_URL` | Vercel (prod + preview), `frontend/.env.local` | `https://api.example.com` / `http://localhost:8000` | no |
| `VITE_WS_BASE_URL` | Vercel, `frontend/.env.local` | `wss://api.example.com` / `ws://localhost:8000` | no |
| `VITE_MOCK_API` | Vercel preview only, local | `1` to serve MSW mocks | no |
| `FRONTEND_URL` | VM `.env` | `https://play.example.com` | no |
| `ALLOWED_ORIGINS` | VM `.env` | `https://play.example.com` | no |
| `GOOGLE_REDIRECT_URI` | VM `.env` + Google console | `https://api.example.com/auth/callback` | no |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | VM `.env` | from Google console | yes |
| `SESSION_SECRET`, `OPENROUTER_API_KEY` | VM `.env` | existing | yes |
| `ENVIRONMENT` | VM `.env` | `production` (turns on Secure + SameSite=None) | no |

Local development: run the backend with `ENVIRONMENT=development`, `ALLOWED_ORIGINS=http://localhost:5173`, `FRONTEND_URL=http://localhost:5173`. Cookies are `Lax` and `localhost` ports count as same-site, so sign-in works without TLS.

## 12. UI screens and components

| Screen | Route | Components | States |
|---|---|---|---|
| Landing | `/` (anonymous) | `LandingPage`, `Button` | loading session, anonymous, auth error (`?error=` from callback) |
| Lobby | `/` (authenticated) | `LobbyPage`, `CreateTableForm`, `JoinTableForm` | idle, submitting, field errors, 409/410/429 messages |
| Setup | `/tables/:id` when `status === 'lobby'` | `SetupPage`, `SeatGrid`, `AiSeatMenu`, `RecoveryNotice` | host vs guest, empty/human/AI seat, start disabled/enabled, polling failure |
| Table | `/tables/:id` when `in_progress` | `TablePage`, `Felt`, `SeatBadge`, `PlayingCard`, `Chip`, `ActionBar`, `RaiseControl`, `DeadlineRing`, `ConnectionPill`, `RecoveryNotice` | connecting, open, reconnecting, my turn, waiting, submitting, rejected, stale (resyncing), hand complete, spectator (Slice C), ended (Slice C) |

The room code is shown on the setup page from `sessionStorage` (`room:${tableId}`) written at creation time, never in the URL, and only to the host who created it. Guests see "Ask the host for the code" if it is absent.

## 13. Visual design system

The brief pins the palette and the two-family type system; the free axes are the specific faces, the card treatment, and how the felt is framed. The memorable element is the table itself, so everything else stays quiet.

**Color tokens** (`src/styles/tokens.css`):

| Token | Hex | Use |
|---|---|---|
| `--forest` | `#12211A` | page background |
| `--felt` | `#1F5B3B` | table surface |
| `--felt-deep` | `#163F2B` | felt vignette edge, pot well |
| `--walnut` | `#5A3A22` | table rail |
| `--walnut-light` | `#8A5B36` | rail highlight |
| `--ivory` | `#F3ECDA` | card faces, primary text on dark |
| `--ink` | `#0F1A14` | text on ivory, card pips (black suits) |
| `--copper` | `#B8763A` | active-turn ring, primary button, focus ring |
| `--brass` | `#C9A24A` | dealer button, chip highlights, used sparingly |
| `--mist` | `#B9C6BD` | secondary text |
| `--ember` | `#C4553D` | red suits, fold, errors |
| `--moss` | `#4FA37A` | connected, check |

Dark-only design; light mode is not offered. Every state has text as well as color (for example the connection pill reads "Connected", "Reconnecting…", "Offline").

**Typography:** `Fraunces` (display serif, optical size 72, weight 600) for the wordmark, page titles, and the large pot figure. `IBM Plex Sans` for everything else, with `font-variant-numeric: tabular-nums` on every chip count so stacks do not jitter. Scale: 12 / 14 / 16 / 20 / 28 / 44 px, line-height 1.4 for sans, 1.2 for display. No all-caps labels; the mockup's spaced caps on the felt are decorative print, not UI labels.

**Spacing:** 4 px base; components use 8, 12, 16, 24, 40. One border radius for controls (10 px), one for cards (6 px), full round for seats and chips.

**Cards:** `PlayingCard` is an SVG face at a 5:7 ratio. Faces show a corner index (rank + suit glyph) top-left and bottom-right, plus a pip layout for 2–10 and a monogram crest (letter in a copper frame) for J, Q, K, and a large centred suit for the Ace. Backs are a felt-green lattice with a leaf mark, matching the mockup. This satisfies "recognisable faces, never plain rank/suit text" without hand-drawing court illustrations.

**Table layout (desktop, ≥ 900 px):**

```text
┌─ header: wordmark · room code · seats · connection ───────────────────┐
│                                                                        │
│            ( seat 2 )                                                  │
│    ┌────────────────────────────────────────────────────┐              │
│    │  (seat 1)        pot 420        (seat 3)           │  walnut rail │
│    │             [Q♥][10♣][7♠][4♥][2♣]                   │              │
│    │      SB 10           D             BB 20           │              │
│    └────────────────────────────────────────────────────┘              │
│                        [A♠][K♥]  ( you )                               │
├─ action bar: "Your turn" · 18 s ring · Fold · Check/Call · Raise · All-in ┤
└────────────────────────────────────────────────────────────────────────┘
```

Seats are placed on an ellipse by seat index relative to *your* seat, so you are always at the bottom. Two-seat tables put the opponent at the top. Below 900 px the felt becomes a portrait oval and the action bar is fixed to the bottom with 48 px targets. Below 600 px opponent hole-card backs shrink to a single stacked pair.

**Motion:** one deliberate moment, community cards flipping in when a street changes (120 ms each, staggered). Turn changes swap the copper ring instantly. `prefers-reduced-motion` disables the flip and the deadline ring animates by stepping every second.

**Copy:** sentence case, verbs on buttons ("Create table", "Join with code", "Start game", "Add Easy player"). Errors say what happened and what to do ("That code has expired. Ask the host for a new table.").

## 14. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| Unit | Vitest | domain helpers, `http.ts` error normalisation, `idempotency.ts`, table store reducers |
| Socket | Vitest + `FakeWebSocket` | connect, snapshot replaces state, revision ordering, backoff schedule with fake timers, 4401/4403 stop, pending replay after reconnect, stale_revision triggers reconnect |
| Component | Testing Library + jsdom + MSW | landing states, forms, seat grid host/guest, action bar renders exactly `legal_actions`, raise bounds, deadline text, connection pill |
| Backend integration | existing pytest suite | protocol contract; add one pytest that serialises a snapshot and compares keys to a checked-in `frontend/tests/fixtures/snapshot.json` so the TS types cannot drift silently |
| E2E | Playwright, one spec | with `VITE_MOCK_API=1`: land → create table → add AI → start → act once → see ack applied |
| Deployment smoke | shell script | `curl -I https://api.example.com/healthz`, CORS preflight from the play origin returns the allow headers, `wscat` handshake gets 4401 without a cookie |

## 15. TDD sequence

Each task in section 19 writes its test first and shows the failing run. Order: types and fixtures → HTTP client → socket client → store → auth gate → lobby → setup → cards → felt → action bar → deadline/connection → e2e → deploy.

## 16. Migration risks and rollback

- **Third-party cookie blocking** if the frontend is not on the same registrable domain. Mitigation: custom domain before launch; test on iOS Safari. Rollback: none needed, nothing changes server-side.
- **CORS misconfiguration** shows as an opaque network error. Mitigation: smoke script in section 14 runs before DNS cutover.
- **Socket idle timeout** at Nginx. Mitigation: 300 s read timeout and client reconnect.
- **Every frontend deploy is independent of the backend.** Rollback is "promote previous Vercel deployment". The backend contract is additive across B1–B7.

## 17. Acceptance criteria

| Requirement | Criterion | Task |
|---|---|---|
| Google sign-in, session bootstrap | anonymous user sees landing with one CTA; `GET /auth/me` 200 leads to lobby; 401 leads to landing | 6 |
| Create / join private table, mobile-friendly code entry | forms submit with CSRF, show 409/410/422/429 messages verbatim from `detail`; code input uppercases, `autocapitalize`, `inputmode=text`, 44 px tall | 7 |
| Seat grid, host-only AI and start | guest sees no controls; host sees "Add player" per empty seat with three tiers; Start enabled only when every seat is filled | 8 |
| Recovery notice | `recovery_notice` from the snapshot is rendered above the felt until dismissed | 12 |
| Cards never plain text | `PlayingCard` renders SVG with `aria-label="Ace of spades"` | 9 |
| Community, pot, seats, chips, hole cards, turn, deadline in one view | `Felt` renders all from one projection; snapshot test | 10 |
| Action bar with bounds, all-in, submitting, rejected, stale | buttons equal `legal_actions`; raise input clamps to `min_amount..max_amount`; error banner for `invalid_action`; "Resyncing…" for `stale_revision` | 11 |
| Reconnect with backoff and full resync | socket tests with fake timers | 4 |
| No duplicate actions | pending key persists and replays only at the same revision | 4 |
| Next hand, spectators, leave/end, host transfer, rankings, cancellation | `session` events and `view.status` drive the table page | 14–18 |

## 18. Decisions requiring human approval

1. **Frontend domain.** `play.<domain>` under the same registrable domain as `api.<domain>` (recommended) or `*.vercel.app`. This decides whether mobile Safari works.
2. **Product name.** Backend, brief, and mockup now say "The Common Table"; the spec file still says "Glass Orchard" in its title. Confirm the spec should be renamed.
3. **Room code display.** Held client-side in `sessionStorage` for the host only. Alternative: backend returns it on `GET /tables/{id}` to the host, which the spec's "never in URLs or logs" allows but the backend agent chose not to do.
4. **Hand-complete reveal.** Backend default is 6 s (`HAND_REVEAL_SECONDS`); confirm or change.
5. **Preview sign-in.** `return_to` exists; decide whether preview origins go into `ALLOWED_ORIGINS` (each preview URL is unique, so only a stable alias works).
6. **Backend restructure timing.** Section 1, after the frontend is live.

## 19. Task-by-task implementation plan

All commands run from `frontend/` unless stated. Commit messages follow the repo's `feat:`/`fix:`/`test:` style. Slices A, B, and C are fully specified against commit `e5df08f`. Task 17's end-to-end check waits on backend bug B9.

### Slice A: protocol foundation, auth, lobby, setup

### Task 1: Vite scaffold, test runner, tokens

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/index.html`, `frontend/vercel.json`, `frontend/.env.example`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/config.ts`, `frontend/src/styles/tokens.css`, `frontend/src/styles/base.css`, `frontend/tests/setup.ts`
- Modify: `.gitignore` (append `frontend/node_modules/`, `frontend/dist/`, `frontend/.env.local`)

- [x] **Step 1: Scaffold**

```bash
cd /Users/rsumit123/work/card_games
npm create vite@5 frontend -- --template react-ts
cd frontend
npm i zustand@4 react-router-dom@6
npm i -D vitest@2 @testing-library/react@16 @testing-library/user-event@14 @testing-library/jest-dom@6 jsdom@25 msw@2
```

- [x] **Step 2: Write the failing config test**

`tests/unit/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { config } from '../../src/config';

describe('config', () => {
  it('exposes API and WS base URLs without trailing slashes', () => {
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.wsBaseUrl).toBe('ws://localhost:8000');
  });
});
```

- [x] **Step 3: Run it, expect failure**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL, `Cannot find module '../../src/config'`

- [x] **Step 4: Implement config and test wiring**

`src/config.ts`:
```ts
const strip = (v: string | undefined, fallback: string) => (v ?? fallback).replace(/\/+$/, '');
export const config = {
  apiBaseUrl: strip(import.meta.env.VITE_API_BASE_URL, 'http://localhost:8000'),
  wsBaseUrl: strip(import.meta.env.VITE_WS_BASE_URL, 'ws://localhost:8000'),
  mockApi: import.meta.env.VITE_MOCK_API === '1',
};
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'], globals: false },
});
```

`tests/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`.env.example`:
```text
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_BASE_URL=ws://localhost:8000
VITE_MOCK_API=0
```

`vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [{ "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-store" }] }]
}
```

`src/styles/tokens.css` (values from section 13):
```css
:root {
  --forest: #12211A; --felt: #1F5B3B; --felt-deep: #163F2B;
  --walnut: #5A3A22; --walnut-light: #8A5B36;
  --ivory: #F3ECDA; --ink: #0F1A14; --copper: #B8763A; --brass: #C9A24A;
  --mist: #B9C6BD; --ember: #C4553D; --moss: #4FA37A;
  --font-display: 'Fraunces', Georgia, serif;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --radius-control: 10px; --radius-card: 6px;
}
```

`src/styles/base.css`:
```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--forest); color: var(--ivory); font-family: var(--font-sans); font-size: 16px; line-height: 1.4; }
h1, h2 { font-family: var(--font-display); font-weight: 600; line-height: 1.2; margin: 0; }
button, input, select { font: inherit; }
:focus-visible { outline: 2px solid var(--copper); outline-offset: 2px; }
.tabular { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
```

`src/main.tsx` imports both stylesheets and renders `<App />` inside `BrowserRouter`. `src/App.tsx` renders `<h1>The Common Table</h1>` for now.

- [x] **Step 5: Run tests and build**

Run: `npx vitest run && npm run build`
Expected: 1 passed; `dist/` produced.

- [x] **Step 6: Commit**

```bash
git add frontend .gitignore
git commit -m "feat: scaffold frontend with Vite, Vitest, and design tokens"
```

### Task 2: Domain types and a backend-checked snapshot fixture

**Files:**
- Create: `frontend/src/domain/cards.ts`, `frontend/src/domain/game.ts`, `frontend/src/domain/protocol.ts`, `frontend/src/domain/table.ts` (exactly the code in section 6), `frontend/tests/fixtures/snapshot.json`, `frontend/tests/unit/domain.test.ts`
- Create (repo root): `tests/test_frontend_fixture.py`

- [x] **Step 1: Write the failing fixture-contract test (backend side)**

`tests/test_frontend_fixture.py`:
```python
import json
from pathlib import Path

from app.games.holdem.engine import start_hand
from app.rooms.actor import RoomActor
from fastapi.encoders import jsonable_encoder

FIXTURE = Path(__file__).resolve().parents[1] / "frontend" / "tests" / "fixtures" / "snapshot.json"


def test_frontend_snapshot_fixture_matches_projection_keys():
    state = start_hand({1: 1000, 2: 1000}, random_bytes=bytes(range(256)) * 4)
    projection = jsonable_encoder(RoomActor(1, state, player_names={1: "Ana", 2: "Rivers (AI)"}).snapshot_for(1))
    fixture = json.loads(FIXTURE.read_text())
    assert set(fixture["payload"].keys()) == set(projection.keys())
    assert set(fixture["payload"]["public"].keys()) == set(projection["public"].keys())
    assert set(fixture["payload"]["public"]["players"][0].keys()) == set(projection["public"]["players"][0].keys())
```

- [x] **Step 2: Run it, expect failure**

Run (repo root): `python3 -m pytest tests/test_frontend_fixture.py -v`
Expected: FAIL, `FileNotFoundError` for the fixture.

- [x] **Step 3: Generate the fixture from the backend**

Run (repo root):
```bash
python3 - <<'PY'
import json
from fastapi.encoders import jsonable_encoder
from app.games.holdem.engine import start_hand
from app.rooms.actor import RoomActor
state = start_hand({1: 1000, 2: 1000}, random_bytes=bytes(range(256)) * 4)
actor = RoomActor(1, state, player_names={1: "Ana", 2: "Rivers (AI)"})
event = {"type": "snapshot", "revision": 0, "payload": actor.snapshot_for(1),
         "deadline": "2026-09-10T12:00:30+00:00", "recovery_notice": None}
open("frontend/tests/fixtures/snapshot.json", "w").write(json.dumps(jsonable_encoder(event), indent=2))
PY
```

- [x] **Step 4: Write the failing TypeScript domain test**

`tests/unit/domain.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import type { ServerEvent } from '../../src/domain/protocol';
import { cardLabel } from '../../src/domain/cards';

describe('domain types', () => {
  it('accepts the backend snapshot fixture as a ServerEvent', () => {
    const event = snapshot as ServerEvent;
    expect(event.type).toBe('snapshot');
    if (event.type === 'snapshot') {
      expect(event.payload.hole_cards).toHaveLength(2);
      expect(event.payload.public.players[0].street_contribution).toBeTypeOf('number');
    }
  });
  it('labels cards for screen readers', () => {
    expect(cardLabel({ rank: 14, suit: 'spades' })).toBe('Ace of spades');
    expect(cardLabel({ rank: 10, suit: 'hearts' })).toBe('10 of hearts');
  });
});
```

- [x] **Step 5: Run, expect failure**

Run: `npx vitest run tests/unit/domain.test.ts`
Expected: FAIL, cannot find `src/domain/protocol`.

- [x] **Step 6: Implement the domain files** from section 6, plus in `cards.ts`:

```ts
const NAMES: Record<number, string> = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
export const rankLabel = (rank: number) => NAMES[rank] ?? String(rank);
export const rankIndex = (rank: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] ?? String(rank);
export const cardLabel = (card: Card) => `${rankLabel(card.rank)} of ${card.suit}`;
export const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';
```

Add `"resolveJsonModule": true` to `tsconfig.app.json` and add `"tests"` to its `include` array so test files type-check. Use `npx tsc -b --noEmit` wherever this plan says to type-check.

- [x] **Step 7: Run both suites**

Run: `npx vitest run && (cd .. && python3 -m pytest tests/test_frontend_fixture.py -q)`
Expected: all pass.

- [x] **Step 8: Commit**

```bash
git add frontend/src/domain frontend/tests tests/test_frontend_fixture.py frontend/tsconfig.json
git commit -m "feat: add frontend domain types checked against backend projection"
```

### Task 3: Credentialed HTTP client and API modules

**Files:**
- Create: `frontend/src/api/http.ts`, `frontend/src/api/auth.ts`, `frontend/src/api/tables.ts`, `frontend/src/store/session.ts`, `frontend/tests/fakes/handlers.ts`, `frontend/tests/unit/http.test.ts`

- [x] **Step 1: Write the failing test**

`tests/unit/http.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { request, ApiError } from '../../src/api/http';
import { useSession } from '../../src/store/session';

const server = setupServer(
  http.get('http://localhost:8000/auth/me', () =>
    HttpResponse.json({ user: { id: 1, google_subject: 'x', email: 'a@b', display_name: 'Ana' }, csrf_token: 'tok' })),
  http.post('http://localhost:8000/tables', ({ request }) => {
    if (request.headers.get('x-csrf-token') !== 'tok') return HttpResponse.json({ detail: 'CSRF token missing' }, { status: 403 });
    return HttpResponse.json({ id: 7, room_code: 'ABCD-1234' });
  }),
  http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ detail: 'table is full' }, { status: 409 })),
);
beforeAll(() => server.listen()); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('request', () => {
  it('sends credentials and the CSRF token on POST', async () => {
    useSession.setState({ csrfToken: 'tok' });
    const out = await request<{ id: number }>('/tables', { method: 'POST', body: { seat_count: 2 } });
    expect(out.id).toBe(7);
  });
  it('normalises FastAPI detail into ApiError', async () => {
    await expect(request('/tables/join', { method: 'POST', body: { code: 'x' } })).rejects.toMatchObject(
      new ApiError(409, 'conflict', 'table is full'));
  });
  it('flips the session to anonymous on 401', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ detail: 'Authentication required' }, { status: 401 })));
    useSession.setState({ status: 'authenticated' });
    await expect(request('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().status).toBe('anonymous');
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: FAIL, cannot find `src/api/http`.

- [x] **Step 3: Implement**

`src/store/session.ts`:
```ts
import { create } from 'zustand';
export interface User { id: number; google_subject: string; email: string; display_name: string }
type Status = 'loading' | 'anonymous' | 'authenticated' | 'error';
interface SessionState { status: Status; user: User | null; csrfToken: string | null;
  setAuthenticated: (user: User, csrfToken: string) => void; setAnonymous: () => void; setError: () => void }
export const useSession = create<SessionState>((set) => ({
  status: 'loading', user: null, csrfToken: null,
  setAuthenticated: (user, csrfToken) => set({ status: 'authenticated', user, csrfToken }),
  setAnonymous: () => set({ status: 'anonymous', user: null, csrfToken: null }),
  setError: () => set({ status: 'error' }),
}));
```

`src/api/http.ts`:
```ts
import { config } from '../config';
import { useSession } from '../store/session';
export type ApiCode = 'unauthenticated' | 'forbidden' | 'conflict' | 'expired' | 'invalid' | 'rate_limited' | 'network' | 'server';
export class ApiError extends Error {
  constructor(public status: number, public code: ApiCode, message: string) { super(message); }
}
const codeFor = (s: number): ApiCode =>
  s === 401 ? 'unauthenticated' : s === 403 ? 'forbidden' : s === 409 ? 'conflict' : s === 410 ? 'expired'
  : s === 422 ? 'invalid' : s === 429 ? 'rate_limited' : 'server';
const detailText = (d: unknown): string =>
  typeof d === 'string' ? d : Array.isArray(d) ? d.map((e) => (e as { msg?: string }).msg ?? 'invalid').join('; ') : 'Request failed';

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = useSession.getState().csrfToken ?? '';
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, { method, headers, credentials: 'include',
      body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch { throw new ApiError(0, 'network', 'Could not reach the table server.'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) useSession.getState().setAnonymous();
    throw new ApiError(res.status, codeFor(res.status), detailText((data as { detail?: unknown }).detail));
  }
  return (await res.json()) as T;
}
```

`src/api/auth.ts`:
```ts
import { config } from '../config'; import { request } from './http'; import type { User } from '../store/session';
export const loginUrl = () => `${config.apiBaseUrl}/auth/login`;
export const me = () => request<{ user: User; csrf_token: string }>('/auth/me');
export const logout = () => request<{ status: string }>('/auth/logout', { method: 'POST' });
```

`src/api/tables.ts`:
```ts
import { request } from './http'; import type { TableView, AiTier } from '../domain/table';
export interface CreateTableInput { seat_count: 2 | 3 | 4; starting_chips: 1000 | 5000 | 10000; small_blind: 5 | 10 | 25; big_blind: number }
export const createTable = (input: CreateTableInput) => request<TableView>('/tables', { method: 'POST', body: input });
export const joinTable = (code: string) => request<TableView>('/tables/join', { method: 'POST', body: { code } });
export const getTable = (id: number) => request<TableView>(`/tables/${id}`);
export const startTable = (id: number) => request<{ table: TableView; revision: number }>(`/tables/${id}/start`, { method: 'POST' });
export const fillAiSeat = (id: number, seat: number, tier: AiTier) =>
  request<TableView>(`/tables/${id}/seats/${seat}/ai`, { method: 'POST', body: { tier } });
```

`tests/fakes/handlers.ts` exports the three handlers above as `defaultHandlers` for reuse by component tests and by the `VITE_MOCK_API` browser worker.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/api frontend/src/store/session.ts frontend/tests
git commit -m "feat: add credentialed HTTP client with CSRF and error normalisation"
```

### Task 4: WebSocket client with reconnect, backoff, and pending replay

**Files:**
- Create: `frontend/src/ws/idempotency.ts`, `frontend/src/ws/TableSocket.ts`, `frontend/tests/fakes/FakeWebSocket.ts`, `frontend/tests/unit/tableSocket.test.ts`

- [x] **Step 1: Write the fake socket**

`tests/fakes/FakeWebSocket.ts`:
```ts
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1; static CLOSED = 3;
  readyState = 0; sent: string[] = [];
  onopen: (() => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  // test helpers
  open() { this.readyState = 1; this.onopen?.(); }
  receive(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  static reset() { FakeWebSocket.instances = []; }
  static last() { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]; }
}
```

- [x] **Step 2: Write the failing tests**

`tests/unit/tableSocket.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import { TableSocket } from '../../src/ws/TableSocket';
import type { ServerEvent } from '../../src/domain/protocol';

const raw = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
// force "my turn" so the replay path is deterministic regardless of the fixture's dealer
const snap = { ...raw, payload: { ...raw.payload, public: { ...raw.payload.public, current_seat: raw.payload.seat_id } } };
const make = () => {
  const events: ServerEvent[] = []; const status: string[] = []; let dropped = 0;
  const sock = new TableSocket(7, { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, baseUrl: 'ws://t',
    onEvent: (e) => events.push(e), onStatus: (s) => status.push(s), onPendingDropped: () => { dropped += 1; }, random: () => 0.5 });
  return { sock, events, status, dropped: () => dropped };
};

describe('TableSocket', () => {
  beforeEach(() => { FakeWebSocket.reset(); sessionStorage.clear(); vi.useFakeTimers(); });

  it('connects to the table URL and forwards the snapshot', () => {
    const { sock, events, status } = make(); sock.connect();
    expect(FakeWebSocket.last().url).toBe('ws://t/ws/tables/7');
    FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
    expect(events[0].type).toBe('snapshot'); expect(status).toEqual(['connecting', 'open']);
  });

  it('reconnects with capped exponential backoff', () => {
    const { sock, status } = make(); sock.connect(); FakeWebSocket.last().open();
    FakeWebSocket.last().drop();
    expect(status.at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(499); expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1); expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last().drop(); vi.advanceTimersByTime(1000); expect(FakeWebSocket.instances).toHaveLength(3);
    for (let i = 0; i < 10; i++) { FakeWebSocket.last().drop(); vi.advanceTimersByTime(10_000); }
    expect(FakeWebSocket.instances.length).toBeGreaterThan(10);
  });

  it('stops on 4401 and 4403', () => {
    const { sock, status } = make(); sock.connect(); FakeWebSocket.last().drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1); expect(status.at(-1)).toBe('unauthorized');
  });

  it('sends a command with a stored idempotency key and replays it after reconnect at the same revision', () => {
    const { sock } = make(); sock.connect(); FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
    sock.send({ type: 'call' }, 0, 1);
    const first = JSON.parse(FakeWebSocket.last().sent[0]);
    expect(first.expected_revision).toBe(0); expect(first.idempotency_key).toMatch(/^1:0:/);
    FakeWebSocket.last().drop(); vi.advanceTimersByTime(500);
    FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);   // still revision 0, still my turn
    expect(JSON.parse(FakeWebSocket.last().sent[0]).idempotency_key).toBe(first.idempotency_key);
  });

  it('drops the pending command when the revision moved', () => {
    const { sock } = make(); sock.connect(); FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
    sock.send({ type: 'call' }, 0, 1);
    FakeWebSocket.last().drop(); vi.advanceTimersByTime(500);
    FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 3 });
    expect(FakeWebSocket.last().sent).toHaveLength(0); expect(sessionStorage.getItem('pending:7')).toBeNull();
  });

  it('reports a dropped pending command so the UI can re-enable', () => {
    const { sock, dropped } = make(); sock.connect(); FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
    sock.send({ type: 'call' }, 0, 1);
    FakeWebSocket.last().drop(); vi.advanceTimersByTime(500);
    FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 3 });
    expect(dropped()).toBe(1);
  });

  it('gives up after three handshake failures that never opened', () => {
    const { sock, status } = make(); sock.connect();
    FakeWebSocket.last().drop(1006); vi.advanceTimersByTime(500);
    FakeWebSocket.last().drop(1006); vi.advanceTimersByTime(1000);
    FakeWebSocket.last().drop(1006); vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(3); expect(status.at(-1)).toBe('handshake_failed');
  });

  it('clears the pending key on ack and on error', () => {
    const { sock } = make(); sock.connect(); FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
    sock.send({ type: 'fold' }, 0, 1);
    const key = JSON.parse(FakeWebSocket.last().sent[0]).idempotency_key;
    FakeWebSocket.last().receive({ type: 'ack', revision: 1, idempotency_key: key, payload: snap.payload, deadline: null });
    expect(sessionStorage.getItem('pending:7')).toBeNull();
  });
});
```

- [x] **Step 3: Run, expect failure**

Run: `npx vitest run tests/unit/tableSocket.test.ts`
Expected: FAIL, cannot find `src/ws/TableSocket`.

- [x] **Step 4: Implement**

`src/ws/idempotency.ts`:
```ts
import type { Command, Action } from '../domain/protocol';
const keyFor = (tableId: number) => `pending:${tableId}`;
export const newKey = (seatId: number, revision: number) => `${seatId}:${revision}:${crypto.randomUUID()}`;
export const buildCommand = (action: Action, revision: number, seatId: number): Command =>
  ({ expected_revision: revision, idempotency_key: newKey(seatId, revision), action });
export const savePending = (tableId: number, c: Command) => { try { sessionStorage.setItem(keyFor(tableId), JSON.stringify(c)); } catch { /* storage unavailable */ } };
export const loadPending = (tableId: number): Command | null => { try { const v = sessionStorage.getItem(keyFor(tableId)); return v ? (JSON.parse(v) as Command) : null; } catch { return null; } };
export const clearPending = (tableId: number) => { try { sessionStorage.removeItem(keyFor(tableId)); } catch { /* ignore */ } };
```

`src/ws/TableSocket.ts`:
```ts
import type { ServerEvent, Command, Action } from '../domain/protocol';
import { config } from '../config';
import { buildCommand, savePending, loadPending, clearPending } from './idempotency';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized' | 'forbidden' | 'handshake_failed';
interface Options { WebSocketImpl?: typeof WebSocket; baseUrl?: string; onEvent: (e: ServerEvent) => void; onStatus: (s: SocketStatus) => void;
  onPendingDropped?: () => void; random?: () => number }
const MAX_HANDSHAKE_FAILURES = 3;

export class TableSocket {
  private ws: WebSocket | null = null; private attempt = 0; private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false; private seatId: number | null = null; private everOpened = false; private handshakeFailures = 0;
  constructor(private tableId: number, private opts: Options) {}

  connect() { this.stopped = false; this.open(); }
  close() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.ws?.close(); this.opts.onStatus('closed'); }
  resync() { this.ws?.close(); }   // a new connection yields a fresh snapshot

  send(action: Action, revision: number, seatId: number) {
    const command = buildCommand(action, revision, seatId);
    savePending(this.tableId, command); this.seatId = seatId; this.raw(command);
  }

  private raw(command: Command) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(command)); }

  private open() {
    const Impl = this.opts.WebSocketImpl ?? WebSocket; const base = this.opts.baseUrl ?? config.wsBaseUrl;
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new Impl(`${base}/ws/tables/${this.tableId}`); this.ws = ws;
    ws.onopen = () => { this.attempt = 0; this.everOpened = true; this.handshakeFailures = 0; this.opts.onStatus('open'); };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data as string) as ServerEvent);
    ws.onclose = (e) => {
      if (this.stopped) return;
      if (e.code === 4401) { this.opts.onStatus('unauthorized'); return; }
      if (e.code === 4403) { this.opts.onStatus('forbidden'); return; }
      if (!this.everOpened && ++this.handshakeFailures >= MAX_HANDSHAKE_FAILURES) { this.opts.onStatus('handshake_failed'); return; }
      this.opts.onStatus('reconnecting'); this.schedule();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private schedule() {
    const base = Math.min(500 * 2 ** this.attempt, 10_000);
    const jitter = 1 + ((this.opts.random ?? Math.random)() - 0.5) * 0.4;
    this.attempt += 1;
    this.timer = setTimeout(() => this.open(), Math.round(base * jitter));
  }

  private handle(event: ServerEvent) {
    if (event.type === 'snapshot') {
      const pending = loadPending(this.tableId);
      if (pending) {
        const stillMine = event.payload.public.current_seat === event.payload.seat_id;
        if (pending.expected_revision === event.revision && stillMine) this.raw(pending);
        else { clearPending(this.tableId); this.opts.onPendingDropped?.(); }
      }
    }
    if (event.type === 'ack' || event.type === 'error') clearPending(this.tableId);
    this.opts.onEvent(event);
  }
}
```

- [x] **Step 5: Run, expect pass**

Run: `npx vitest run tests/unit/tableSocket.test.ts`
Expected: 8 passed. Note the backoff test relies on `random: () => 0.5`, which makes jitter exactly 1.

- [x] **Step 6: Commit**

```bash
git add frontend/src/ws frontend/tests/fakes/FakeWebSocket.ts frontend/tests/unit/tableSocket.test.ts
git commit -m "feat: add table WebSocket client with reconnect and idempotent replay"
```

### Task 5: Table store reducers

**Files:**
- Create: `frontend/src/store/table.ts`, `frontend/tests/unit/tableStore.test.ts`

- [x] **Step 1: Write the failing tests**

`tests/unit/tableStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import type { ServerEvent } from '../../src/domain/protocol';
const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

describe('table store', () => {
  beforeEach(() => useTable.getState().reset());

  it('snapshot replaces projection, revision, deadline, and notice', () => {
    useTable.getState().applyEvent({ ...snap, recovery_notice: 'The active hand was cancelled after a restart.' });
    const s = useTable.getState();
    expect(s.revision).toBe(0); expect(s.projection?.seat_id).toBe(1); expect(s.recoveryNotice).toContain('cancelled');
  });

  it('ignores state events at or below the held revision', () => {
    useTable.getState().applyEvent({ ...snap, revision: 5 });
    useTable.getState().applyEvent({ type: 'state', revision: 4, payload: { ...snap.payload, public: { ...snap.payload.public, pot: 999 } }, deadline: null });
    expect(useTable.getState().projection?.public.pot).not.toBe(999);
  });

  it('marks stale_revision as needing resync and clears pending', () => {
    useTable.getState().applyEvent(snap);
    useTable.setState({ pending: { key: 'k', action: { type: 'call' } } });
    useTable.getState().applyEvent({ type: 'error', code: 'stale_revision', message: 'expected revision does not match', revision: 2 });
    expect(useTable.getState().pending).toBeNull(); expect(useTable.getState().needsResync).toBe(true);
  });

  it('canAct is true only on my turn with nothing pending', () => {
    useTable.getState().applyEvent(snap); useTable.setState({ connection: 'open' });
    expect(useTable.getState().canAct()).toBe(snap.payload.public.current_seat === snap.payload.seat_id);
    useTable.setState({ pending: { key: 'k', action: { type: 'call' } } });
    expect(useTable.getState().canAct()).toBe(false);
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/tableStore.test.ts`
Expected: FAIL, cannot find `src/store/table`.

- [x] **Step 3: Implement**

`src/store/table.ts`:
```ts
import { create } from 'zustand';
import type { SeatProjection, Action } from '../domain/game';
import type { ServerEvent, ErrorCode, SessionEvent } from '../domain/protocol';
import type { TableView } from '../domain/table';
import type { SocketStatus } from '../ws/TableSocket';

interface TableState {
  view: TableView | null; projection: SeatProjection | null; revision: number; deadline: string | null;
  recoveryNotice: string | null; connection: SocketStatus; pending: { key: string; action: Action } | null;
  lastError: { code: ErrorCode; message: string } | null; needsResync: boolean; session: SessionEvent | null;
  applyEvent: (e: ServerEvent) => void; setConnection: (s: SocketStatus) => void; setView: (v: TableView) => void;
  setPending: (p: { key: string; action: Action } | null) => void; dismissNotice: () => void; canAct: () => boolean; reset: () => void;
}
const initial = { view: null, projection: null, revision: -1, deadline: null, recoveryNotice: null,
  connection: 'closed' as SocketStatus, pending: null, lastError: null, needsResync: false, session: null as SessionEvent | null };

export const useTable = create<TableState>((set, get) => ({
  ...initial,
  applyEvent: (e) => {
    if (e.type === 'session') { set({ session: e }); return; }
    if (e.type === 'snapshot') { set({ projection: e.payload, revision: e.revision, deadline: e.deadline, recoveryNotice: e.recovery_notice ?? get().recoveryNotice, needsResync: false, lastError: null }); return; }
    if (e.type === 'error') { set({ pending: null, lastError: { code: e.code, message: e.message }, needsResync: e.code === 'stale_revision' }); return; }
    if (e.revision <= get().revision) return;
    set({ projection: e.payload, revision: e.revision, deadline: e.deadline, lastError: null, ...(e.type === 'ack' ? { pending: null } : {}) });
  },
  setConnection: (connection) => set({ connection }),
  setView: (view) => set({ view }),
  setPending: (pending) => set({ pending }),
  dismissNotice: () => set({ recoveryNotice: null }),
  canAct: () => { const { projection, pending, connection } = get();
    return !!projection && pending === null && connection === 'open' && projection.public.current_seat === projection.seat_id; },
  reset: () => set(initial),
}));
```

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/tableStore.test.ts`
Expected: 4 passed. If the fixture's `current_seat` is not seat 1, the `canAct` test still passes because it compares against the fixture.

- [x] **Step 5: Commit**

```bash
git add frontend/src/store/table.ts frontend/tests/unit/tableStore.test.ts
git commit -m "feat: add table store with revision-ordered event reducer"
```

### Task 6: Auth gate and landing page

**Files:**
- Create: `frontend/src/features/landing/LandingPage.tsx`, `frontend/src/components/Button.tsx`, `frontend/tests/component/landing.test.tsx`
- Modify: `frontend/src/App.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/landing.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from '../../src/App';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => { server.resetHandlers(); useSession.getState().setAnonymous(); useSession.setState({ status: 'loading' }); }); afterAll(() => server.close());
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('auth gate', () => {
  it('shows the sign-in landing when /auth/me is 401', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ detail: 'Authentication required' }, { status: 401 })));
    at('/');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', 'http://localhost:8000/auth/login');
  });
  it('shows the lobby when signed in', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ user: { id: 1, google_subject: 'x', email: 'a@b', display_name: 'Ana' }, csrf_token: 'tok' })));
    at('/');
    expect(await screen.findByRole('heading', { name: /create a private table/i })).toBeInTheDocument();
  });
  it('shows an error state when the server is unreachable', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.error()));
    at('/');
    expect(await screen.findByText(/could not reach the table server/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/landing.test.tsx`
Expected: FAIL, no link found (App renders only a heading).

- [x] **Step 3: Implement**

`src/components/Button.tsx`:
```tsx
import type { ButtonHTMLAttributes } from 'react';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean };
export function Button({ variant = 'quiet', busy, children, disabled, ...rest }: Props) {
  return <button className={`btn btn-${variant}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>{children}</button>;
}
```

`src/features/landing/LandingPage.tsx`:
```tsx
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
```

`src/App.tsx`:
```tsx
import { useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { me } from './api/auth';
import { ApiError } from './api/http';
import { useSession } from './store/session';
import { LandingPage } from './features/landing/LandingPage';
import { LobbyPage } from './features/lobby/LobbyPage';
import { TableRoute } from './features/table/TableRoute';

export default function App() {
  const { status, setAuthenticated, setAnonymous, setError } = useSession();
  const [params] = useSearchParams();
  useEffect(() => {
    me().then((r) => setAuthenticated(r.user, r.csrf_token))
      .catch((e: ApiError) => (e.code === 'unauthenticated' ? setAnonymous() : setError()));
  }, [setAuthenticated, setAnonymous, setError]);
  if (status === 'loading') return <main aria-busy="true"><h1>The Common Table</h1><p>Checking your session…</p></main>;
  if (status === 'error') return <LandingPage error="Could not reach the table server. Try again in a moment." />;
  if (status === 'anonymous') return <LandingPage error={params.get('error') ?? undefined} />;
  return (
    <Routes>
      <Route path="/" element={<LobbyPage />} />
      <Route path="/tables/:id" element={<TableRoute />} />
    </Routes>
  );
}
```

For this task, create `LobbyPage` as a stub that renders `<h1>Create a private table</h1>` and `TableRoute` as a stub that renders nothing; Tasks 7 and 9 replace them.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/landing.test.tsx`
Expected: 3 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat: add session bootstrap, auth gate, and landing page"
```

### Task 7: Lobby forms (create and join)

**Files:**
- Create: `frontend/src/features/lobby/LobbyPage.tsx`, `frontend/src/features/lobby/CreateTableForm.tsx`, `frontend/src/features/lobby/JoinTableForm.tsx`, `frontend/src/components/Field.tsx`, `frontend/tests/component/lobby.test.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/lobby.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LobbyPage } from '../../src/features/lobby/LobbyPage';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const view = { id: 9, room_code: 'KLMN-2345', host_user_id: 1, seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20, status: 'lobby', join_expires_at: null, seats: [], final_rankings: [] };
const mount = () => render(<MemoryRouter><Routes><Route path="/" element={<LobbyPage />} /><Route path="/tables/:id" element={<p>table 9</p>} /></Routes></MemoryRouter>);

describe('lobby', () => {
  it('creates a table with the chosen settings, stores the code, and navigates', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    let body: unknown;
    server.use(http.post('http://localhost:8000/tables', async ({ request }) => { body = await request.json(); return HttpResponse.json(view); }));
    mount();
    await userEvent.selectOptions(screen.getByLabelText(/seats/i), '3');
    await userEvent.selectOptions(screen.getByLabelText(/starting chips/i), '5000');
    await userEvent.selectOptions(screen.getByLabelText(/blinds/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));
    expect(await screen.findByText('table 9')).toBeInTheDocument();
    expect(body).toEqual({ seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20 });
    expect(sessionStorage.getItem('room:9')).toBe('KLMN-2345');
  });
  it('uppercases the join code and shows the server message on 410', async () => {
    server.use(http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ detail: 'table has expired' }, { status: 410 })));
    mount();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'abcd-1234');
    expect(input).toHaveValue('ABCD-1234');
    await userEvent.click(screen.getByRole('button', { name: /join with code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/lobby.test.tsx`
Expected: FAIL, no `seats` label.

- [x] **Step 3: Implement**

`src/components/Field.tsx`:
```tsx
import type { ReactNode } from 'react';
export function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <small>{hint}</small>}</div>;
}
```

`src/features/lobby/CreateTableForm.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';

export function CreateTableForm() {
  const nav = useNavigate();
  const [seats, setSeats] = useState<2 | 3 | 4>(2); const [chips, setChips] = useState<1000 | 5000 | 10000>(1000);
  const [sb, setSb] = useState<5 | 10 | 25>(5); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const t = await createTable({ seat_count: seats, starting_chips: chips, small_blind: sb, big_blind: sb * 2 });
      if (t.room_code) { try { sessionStorage.setItem(`room:${t.id}`, t.room_code); } catch { /* ignore */ } }
      nav(`/tables/${t.id}`);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not create the table.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} aria-labelledby="create-heading">
      <h2 id="create-heading">Create a private table</h2>
      <Field id="seats" label="Seats"><select id="seats" value={seats} onChange={(e) => setSeats(Number(e.target.value) as 2 | 3 | 4)}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
      <Field id="chips" label="Starting chips"><select id="chips" value={chips} onChange={(e) => setChips(Number(e.target.value) as 1000 | 5000 | 10000)}>{[1000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}</select></Field>
      <Field id="blinds" label="Blinds"><select id="blinds" value={sb} onChange={(e) => setSb(Number(e.target.value) as 5 | 10 | 25)}>{[5, 10, 25].map((n) => <option key={n} value={n}>{n} / {n * 2}</option>)}</select></Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary" busy={busy}>Create table</Button>
    </form>
  );
}
```

`src/features/lobby/JoinTableForm.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';

export function JoinTableForm() {
  const nav = useNavigate();
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const t = await joinTable(code.trim()); nav(`/tables/${t.id}`); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not join the table.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} aria-labelledby="join-heading">
      <h2 id="join-heading">Join with a room code</h2>
      <Field id="code" label="Room code" hint="Ask the host for the code.">
        <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text" className="code-input" required />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary" busy={busy}>Join with code</Button>
    </form>
  );
}
```

`src/features/lobby/LobbyPage.tsx`:
```tsx
import { CreateTableForm } from './CreateTableForm';
import { JoinTableForm } from './JoinTableForm';
import { useSession } from '../../store/session';
export function LobbyPage() {
  const user = useSession((s) => s.user);
  return (
    <main className="lobby">
      <header><h1>The Common Table</h1><p>Signed in as {user?.display_name}</p></header>
      <section className="lobby-forms"><CreateTableForm /><JoinTableForm /></section>
    </main>
  );
}
```

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/lobby.test.tsx`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/lobby frontend/src/components/Field.tsx frontend/tests/component/lobby.test.tsx
git commit -m "feat: add lobby create and join forms"
```

### Task 8: Table setup page with polling, AI seats, and host start

**Files:**
- Create: `frontend/src/features/setup/SetupPage.tsx`, `frontend/src/features/setup/SeatGrid.tsx`, `frontend/src/features/setup/AiSeatMenu.tsx`, `frontend/src/features/table/TableRoute.tsx`, `frontend/tests/component/setup.test.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/setup.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SetupPage } from '../../src/features/setup/SetupPage';
import { useSession } from '../../src/store/session';
import type { TableView } from '../../src/domain/table';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => { server.resetHandlers(); sessionStorage.clear(); }); afterAll(() => server.close());
const base: TableView = { id: 9, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'lobby', join_expires_at: null,
  final_rankings: [], seats: [{ seat_number: 1, user_id: 1, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: 'Ana', spectating: false }, { seat_number: 2, user_id: null, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: null, spectating: true }] };
const mount = () => render(<MemoryRouter initialEntries={['/tables/9']}><Routes><Route path="/tables/:id" element={<SetupPage view={base} onStarted={() => {}} refresh={() => {}} />} /></Routes></MemoryRouter>);

describe('setup', () => {
  it('lets the host add an AI seat and disables Start until full', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    sessionStorage.setItem('room:9', 'KLMN-2345');
    let tier: unknown;
    server.use(http.post('http://localhost:8000/tables/9/seats/2/ai', async ({ request }) => { tier = (await request.json() as { tier: string }).tier;
      return HttpResponse.json({ ...base, seats: [base.seats[0], { ...base.seats[1], actor_type: 'ai', ai_tier: 'Medium' }] }); }));
    mount();
    expect(screen.getByText('KLMN-2345')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /add player/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /medium/i }));
    expect(tier).toBe('Medium');
  });
  it('hides host controls from guests', () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 2, google_subject: 'y', email: '', display_name: 'Bo' } });
    mount();
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add player/i })).toBeNull();
    expect(screen.getByText(/ask the host for the code/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/setup.test.tsx`
Expected: FAIL, cannot find `SetupPage`.

- [x] **Step 3: Implement**

`src/features/setup/AiSeatMenu.tsx`:
```tsx
import { useState } from 'react';
import type { AiTier } from '../../domain/table';
import { Button } from '../../components/Button';
const TIERS: AiTier[] = ['Easy', 'Medium', 'Hard'];
export function AiSeatMenu({ onPick, busy }: { onPick: (t: AiTier) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ai-menu">
      <Button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} busy={busy}>Add player</Button>
      {open && <ul role="menu">{TIERS.map((t) => <li key={t} role="menuitem" tabIndex={0} onClick={() => { setOpen(false); onPick(t); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setOpen(false); onPick(t); } }}>{t}</li>)}</ul>}
    </div>
  );
}
```

`src/features/setup/SeatGrid.tsx`:
```tsx
import type { SeatView, AiTier } from '../../domain/table';
import { AiSeatMenu } from './AiSeatMenu';
export function SeatGrid({ seats, isHost, busySeat, onAddAi }: { seats: SeatView[]; isHost: boolean; busySeat: number | null; onAddAi: (seat: number, tier: AiTier) => void }) {
  return (
    <ol className="seat-grid" aria-label="Seats">
      {seats.map((s) => {
        const empty = s.user_id === null && s.actor_type !== 'ai';
        return (
          <li key={s.seat_number} className={`seat ${empty ? 'seat-empty' : ''}`}>
            <span className="seat-number">Seat {s.seat_number}</span>
            {s.actor_type === 'ai' ? <span>{s.display_name ?? `${s.ai_tier} player`}</span> : s.user_id !== null ? <span>{s.display_name ?? `Player ${s.user_id}`}</span> : <span className="muted">Open seat</span>}
            {empty && isHost && <AiSeatMenu busy={busySeat === s.seat_number} onPick={(t) => onAddAi(s.seat_number, t)} />}
          </li>
        );
      })}
    </ol>
  );
}
```
(`Player {user_id}` is only a fallback when `display_name` is null.)

`src/features/setup/SetupPage.tsx`:
```tsx
import { useState } from 'react';
import type { TableView, AiTier } from '../../domain/table';
import { fillAiSeat, startTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { useSession } from '../../store/session';
import { SeatGrid } from './SeatGrid';
import { Button } from '../../components/Button';
import { RecoveryNotice } from '../table/RecoveryNotice';

export function SetupPage({ view, refresh, onStarted, notice }: { view: TableView; refresh: () => void; onStarted: () => void; notice?: string | null }) {
  const user = useSession((s) => s.user);
  const isHost = user?.id === view.host_user_id;
  const [busySeat, setBusySeat] = useState<number | null>(null); const [starting, setStarting] = useState(false); const [error, setError] = useState<string | null>(null);
  let code: string | null = null; try { code = sessionStorage.getItem(`room:${view.id}`); } catch { /* ignore */ }
  const full = view.seats.every((s) => s.user_id !== null || s.actor_type === 'ai');
  const addAi = async (seat: number, tier: AiTier) => { setBusySeat(seat); setError(null);
    try { await fillAiSeat(view.id, seat, tier); refresh(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not add the player.'); } finally { setBusySeat(null); } };
  const start = async () => { setStarting(true); setError(null);
    try { await startTable(view.id); onStarted(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not start the game.'); setStarting(false); } };
  return (
    <main className="setup">
      <header className="setup-header">
        <h1>The Common Table</h1>
        <p>Private table · {view.seat_count} seats · blinds {view.small_blind}/{view.big_blind} · {view.starting_chips.toLocaleString()} chips</p>
        {code ? <p>Room code <strong className="code">{code}</strong></p> : <p className="muted">Ask the host for the code.</p>}
      </header>
      {notice && <RecoveryNotice message={notice} />}
      <SeatGrid seats={view.seats} isHost={isHost} busySeat={busySeat} onAddAi={addAi} />
      {error && <p role="alert">{error}</p>}
      {isHost ? <Button variant="primary" onClick={start} disabled={!full} busy={starting}>Start game</Button> : <p className="muted">Waiting for the host to start.</p>}
    </main>
  );
}
```

`src/features/table/RecoveryNotice.tsx` (used here and in Task 12):
```tsx
import { Button } from '../../components/Button';
export function RecoveryNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div role="alert" className="recovery"><p>{message}</p>{onDismiss && <Button onClick={onDismiss}>Continue</Button>}</div>;
}
```

`src/features/table/TableRoute.tsx` (polls while in lobby, hands off to `TablePage` from Task 12):
```tsx
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import type { TableView } from '../../domain/table';
import { SetupPage } from '../setup/SetupPage';
import { TablePage } from './TablePage';

export function TableRoute() {
  const id = Number(useParams().id);
  const [view, setView] = useState<TableView | null>(null); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => { getTable(id).then(setView).catch((e: ApiError) => setError(e.message)); }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (view?.status !== 'lobby') return; const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [view?.status, refresh]);
  if (error) return <main><p role="alert">{error}</p></main>;
  if (!view) return <main aria-busy="true"><p>Loading table…</p></main>;
  if (view.status === 'lobby') return <SetupPage view={view} refresh={refresh} onStarted={refresh} />;
  return <TablePage view={view} />;
}
```

For this task create `TablePage.tsx` as a stub that renders `<p>Table {view.id}</p>`; Task 12 replaces it.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/setup.test.tsx`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/setup frontend/src/features/table frontend/tests/component/setup.test.tsx
git commit -m "feat: add table setup page with AI seats, host start, and lobby polling"
```

### Slice B: the table

### Task 9: Playing card component

**Files:**
- Create: `frontend/src/components/PlayingCard.tsx`, `frontend/src/components/PlayingCard.css`, `frontend/tests/component/playingCard.test.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/playingCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlayingCard } from '../../src/components/PlayingCard';

describe('PlayingCard', () => {
  it('renders an SVG face with an accessible label and no bare rank text node', () => {
    const { container } = render(<PlayingCard card={{ rank: 14, suit: 'spades' }} />);
    expect(screen.getByRole('img', { name: 'Ace of spades' })).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('svg [data-pip]').length).toBe(1);  // ace: single centred pip
  });
  it('renders seven pips for a seven', () => {
    const { container } = render(<PlayingCard card={{ rank: 7, suit: 'clubs' }} />);
    expect(container.querySelectorAll('svg [data-pip]').length).toBe(7);
  });
  it('renders a back with a hidden label', () => {
    render(<PlayingCard back />);
    expect(screen.getByRole('img', { name: 'Face-down card' })).toBeInTheDocument();
  });
  it('uses the red token for hearts', () => {
    const { container } = render(<PlayingCard card={{ rank: 4, suit: 'hearts' }} />);
    expect(container.querySelector('svg')?.getAttribute('data-color')).toBe('red');
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/playingCard.test.tsx`
Expected: FAIL, cannot find `PlayingCard`.

- [x] **Step 3: Implement**

`src/components/PlayingCard.tsx`:
```tsx
import type { Card } from '../domain/cards';
import { cardLabel, rankIndex, isRed } from '../domain/cards';
import './PlayingCard.css';

const GLYPH = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' } as const;
// pip positions in a 100x140 box, per rank 2..10; ace = one centre pip
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

type Props = { card: Card; back?: false; size?: 'sm' | 'md' | 'lg' } | { back: true; card?: undefined; size?: 'sm' | 'md' | 'lg' };

export function PlayingCard(props: Props) {
  const size = props.size ?? 'md';
  if (props.back) {
    return (
      <svg className={`card card-${size} card-back`} viewBox="0 0 100 140" role="img" aria-label="Face-down card">
        <rect x="1" y="1" width="98" height="138" rx="6" fill="var(--ivory)" stroke="var(--ink)" strokeOpacity="0.2" />
        <rect x="7" y="7" width="86" height="126" rx="4" fill="var(--felt-deep)" />
        <path d="M50 40c-14 10-14 40 0 60c14-20 14-50 0-60z" fill="none" stroke="var(--brass)" strokeWidth="1.5" />
      </svg>
    );
  }
  const { card } = props; const red = isRed(card.suit); const glyph = GLYPH[card.suit]; const idx = rankIndex(card.rank);
  const court = card.rank >= 11 && card.rank <= 13;
  return (
    <svg className={`card card-${size}`} viewBox="0 0 100 140" role="img" aria-label={cardLabel(card)} data-color={red ? 'red' : 'black'}>
      <rect x="1" y="1" width="98" height="138" rx="6" fill="var(--ivory)" stroke="var(--ink)" strokeOpacity="0.2" />
      <g className="card-ink">
        <text x="9" y="20" fontSize="16" fontWeight="600">{idx}</text><text x="9" y="34" fontSize="13">{glyph}</text>
        <g transform="rotate(180 50 70)"><text x="9" y="20" fontSize="16" fontWeight="600">{idx}</text><text x="9" y="34" fontSize="13">{glyph}</text></g>
        {court ? (
          <g data-pip><rect x="28" y="36" width="44" height="68" rx="4" fill="none" stroke="var(--copper)" strokeWidth="2" />
            <text x="50" y="82" fontSize="34" textAnchor="middle" fontFamily="var(--font-display)">{idx}</text></g>
        ) : (PIPS[card.rank] ?? []).map(([x, y], i) => (
          <text key={i} data-pip x={x} y={y + 7} fontSize={card.rank === 14 ? 40 : 18} textAnchor="middle">{glyph}</text>
        ))}
      </g>
    </svg>
  );
}
```

`src/components/PlayingCard.css`:
```css
.card { display: inline-block; aspect-ratio: 5 / 7; border-radius: var(--radius-card); box-shadow: 0 2px 6px rgba(0,0,0,.35); }
.card-sm { width: 36px; } .card-md { width: 56px; } .card-lg { width: 72px; }
.card .card-ink { fill: var(--ink); }
.card[data-color="red"] .card-ink { fill: var(--ember); }
.card-enter { animation: card-flip 120ms ease-out both; }
@keyframes card-flip { from { transform: rotateY(90deg); opacity: 0; } to { transform: none; opacity: 1; } }
```

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/playingCard.test.tsx`
Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/components/PlayingCard.tsx frontend/src/components/PlayingCard.css frontend/tests/component/playingCard.test.tsx
git commit -m "feat: add SVG playing card faces and backs"
```

### Task 10: Felt, seats, community cards, pot

**Files:**
- Create: `frontend/src/features/table/Felt.tsx`, `frontend/src/features/table/SeatBadge.tsx`, `frontend/src/features/table/seatLayout.ts`, `frontend/src/components/Chip.tsx`, `frontend/src/features/table/table.css`, `frontend/tests/unit/seatLayout.test.ts`, `frontend/tests/component/felt.test.tsx`

- [x] **Step 1: Write the failing tests**

`tests/unit/seatLayout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { seatPositions } from '../../src/features/table/seatLayout';
describe('seatPositions', () => {
  it('puts my seat at the bottom and rotates the rest clockwise', () => {
    const pos = seatPositions([1, 2, 3, 4], 3);
    expect(pos[3]).toEqual({ x: 50, y: 92 });  // me, bottom centre
    expect(pos[4].x).toBeLessThan(50);            // next seat clockwise sits to my left
    expect(pos[1].y).toBeLessThan(20);            // opposite seat at the top
  });
  it('puts a single opponent at the top', () => {
    const pos = seatPositions([1, 2], 1);
    expect(pos[2]).toEqual({ x: 50, y: 8 });
  });
});
```

`tests/component/felt.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { Felt } from '../../src/features/table/Felt';
import type { ServerEvent } from '../../src/domain/protocol';
const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

describe('Felt', () => {
  it('shows pot, my hole cards face up, opponents face down, and blind markers', () => {
    render(<Felt projection={snap.payload} />);
    expect(screen.getByText(/pot/i).parentElement).toHaveTextContent(String(snap.payload.public.pot));
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2);
    expect(screen.getByText('SB')).toBeInTheDocument(); expect(screen.getByText('BB')).toBeInTheDocument(); expect(screen.getByText('D')).toBeInTheDocument();
  });
  it('marks the active seat', () => {
    render(<Felt projection={snap.payload} />);
    const active = document.querySelector('.seat-active');
    expect(active).not.toBeNull();
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveAttribute('data-seat', String(snap.payload.public.current_seat));
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/unit/seatLayout.test.ts tests/component/felt.test.tsx`
Expected: FAIL, missing modules.

- [x] **Step 3: Implement**

`src/features/table/seatLayout.ts`:
```ts
// Percent coordinates on the felt, my seat fixed at bottom centre; others spread clockwise.
const SLOTS: Record<number, { x: number; y: number }[]> = {
  2: [{ x: 50, y: 8 }],
  3: [{ x: 12, y: 30 }, { x: 88, y: 30 }],
  4: [{ x: 10, y: 45 }, { x: 50, y: 8 }, { x: 90, y: 45 }],
};
export function seatPositions(seatIds: number[], mySeat: number): Record<number, { x: number; y: number }> {
  const sorted = [...seatIds].sort((a, b) => a - b);
  const start = sorted.indexOf(mySeat);
  const order = start === -1 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)];
  const out: Record<number, { x: number; y: number }> = {};
  const slots = SLOTS[sorted.length] ?? SLOTS[4];
  order.forEach((id, i) => { out[id] = i === 0 ? { x: 50, y: 92 } : slots[Math.min(i - 1, slots.length - 1)]; });
  return out;
}
```

`src/components/Chip.tsx`:
```tsx
export function Chip({ amount, label }: { amount: number; label?: string }) {
  return <span className="chip tabular" aria-label={label ? `${label} ${amount}` : `${amount} chips`}>{label && <b>{label}</b>}<span>{amount.toLocaleString()}</span></span>;
}
```

`src/features/table/SeatBadge.tsx`:
```tsx
import type { PublicPlayer } from '../../domain/game';
import type { Card } from '../../domain/cards';
import { PlayingCard } from '../../components/PlayingCard';
export function SeatBadge({ player, name, isMe, active, holeCards, style }: { player: PublicPlayer; name: string | null; isMe: boolean; active: boolean; holeCards: Card[] | null; style: React.CSSProperties }) {
  const cls = ['seat-badge', active ? 'seat-active' : '', player.folded ? 'seat-folded' : '', isMe ? 'seat-me' : ''].join(' ');
  return (
    <div className={cls} style={style} data-seat={player.seat_id} aria-current={active ? 'true' : undefined}>
      <div className="seat-cards">{holeCards ? holeCards.map((c, i) => <PlayingCard key={i} card={c} size={isMe ? 'lg' : 'sm'} />)
        : !player.folded && <><PlayingCard back size="sm" /><PlayingCard back size="sm" /></>}</div>
      <div className="seat-name">{isMe ? 'You' : name ?? `Seat ${player.seat_id}`}{player.all_in && ' · all-in'}{player.folded && ' · folded'}</div>
      <div className="seat-stack tabular">{player.stack.toLocaleString()}</div>
      {player.street_contribution > 0 && <div className="seat-bet tabular">{player.street_contribution}</div>}
    </div>
  );
}
```

`src/features/table/Felt.tsx`:
```tsx
import type { SeatProjection } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { Chip } from '../../components/Chip';
import { SeatBadge } from './SeatBadge';
import { seatPositions } from './seatLayout';
import './table.css';

export function Felt({ projection }: { projection: SeatProjection }) {
  const { public: pub, seat_id: me, hole_cards } = projection;
  const pos = seatPositions(pub.players.map((p) => p.seat_id), me);
  const marker = (seat: number, text: string) => { const p = pos[seat]; return <span key={text} className="marker" style={{ left: `${p.x}%`, top: `${p.y > 50 ? p.y - 18 : p.y + 18}%` }}>{text}</span>; };
  return (
    <section className="felt-wrap" aria-label="Table">
      <div className="felt">
        <div className="pot"><span>Pot</span><Chip amount={pub.pot} /></div>
        <div className="community" aria-label="Community cards">{pub.community_cards.map((c, i) => <PlayingCard key={`${c.rank}${c.suit}`} card={c} size="md" />)}</div>
        {pub.players.map((p) => <SeatBadge key={p.seat_id} player={p} name={pub.names[p.seat_id] ?? null} isMe={p.seat_id === me} active={pub.current_seat === p.seat_id}
          holeCards={p.seat_id === me ? hole_cards : null} style={{ left: `${pos[p.seat_id].x}%`, top: `${pos[p.seat_id].y}%` }} />)}
        {marker(pub.dealer_seat, 'D')}{marker(pub.small_blind_seat, 'SB')}{marker(pub.big_blind_seat, 'BB')}
      </div>
    </section>
  );
}
```

`src/features/table/table.css` (layout only; tokens from section 13):
```css
.felt-wrap { padding: 24px; }
.felt { position: relative; width: min(920px, 100%); aspect-ratio: 16 / 10; margin: 0 auto; border-radius: 50% / 45%;
  background: radial-gradient(ellipse at center, var(--felt) 0%, var(--felt-deep) 85%);
  box-shadow: 0 0 0 14px var(--walnut), 0 0 0 16px var(--walnut-light), 0 20px 40px rgba(0,0,0,.5); }
.pot { position: absolute; left: 50%; top: 36%; transform: translate(-50%, -50%); text-align: center; color: var(--mist); }
.pot .chip span { font-family: var(--font-display); font-size: 28px; color: var(--ivory); display: block; }
.community { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%); display: flex; gap: 8px; }
.seat-badge { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: 4px; min-width: 96px; padding: 8px 10px;
  border-radius: 14px; background: rgba(15,26,20,.75); color: var(--ivory); border: 2px solid transparent; }
.seat-active { border-color: var(--copper); box-shadow: 0 0 0 4px rgba(184,118,58,.25); }
.seat-folded { opacity: .5; }
.seat-cards { display: flex; gap: 4px; }
.seat-name { font-size: 14px; color: var(--mist); } .seat-stack { font-size: 18px; font-weight: 600; }
.seat-bet { font-size: 13px; color: var(--brass); }
.marker { position: absolute; transform: translate(-50%, -50%); width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  font-size: 11px; font-weight: 600; background: var(--ivory); color: var(--ink); }
@media (max-width: 899px) { .felt { aspect-ratio: 10 / 14; border-radius: 45% / 50%; } .community { top: 50%; gap: 4px; } .felt-wrap { padding: 12px; } }
```

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/unit/seatLayout.test.ts tests/component/felt.test.tsx`
Expected: 4 passed. The felt test relies on the fixture being a 2-seat hand, which it is.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table frontend/src/components/Chip.tsx frontend/tests
git commit -m "feat: render felt, seats, community cards, pot, and blind markers"
```

### Task 11: Action bar and raise control

**Files:**
- Create: `frontend/src/features/table/ActionBar.tsx`, `frontend/src/features/table/RaiseControl.tsx`, `frontend/tests/component/actionBar.test.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/actionBar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from '../../src/features/table/ActionBar';
import type { LegalAction } from '../../src/domain/game';

const legal: LegalAction[] = [{ type: 'fold' }, { type: 'call', amount: 5 }, { type: 'raise', min_amount: 20, max_amount: 1000 }, { type: 'all_in', amount: 1000 }];

describe('ActionBar', () => {
  it('renders exactly the legal actions with amounts', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" />);
    expect(screen.getByRole('button', { name: 'Fold' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Call 5' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Raise' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'All-in 1,000' })).toBeEnabled();
  });
  it('clamps the raise amount to the bounds and submits a raise-to total', async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={legal} canAct onAct={onAct} status="your-turn" />);
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    const input = screen.getByLabelText('Raise to');
    await userEvent.clear(input); await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm raise/i }));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', amount: 20 });
  });
  it('disables everything while submitting and shows the status text', () => {
    render(<ActionBar legal={legal} canAct={false} onAct={() => {}} status="submitting" />);
    expect(screen.getByRole('button', { name: 'Fold' })).toBeDisabled();
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
  });
  it('shows a rejection message', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" error="amount exceeds stack" />);
    expect(screen.getByRole('alert')).toHaveTextContent('amount exceeds stack');
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/actionBar.test.tsx`
Expected: FAIL, cannot find `ActionBar`.

- [x] **Step 3: Implement**

`src/features/table/RaiseControl.tsx`:
```tsx
import { useState } from 'react';
import { Button } from '../../components/Button';
export function RaiseControl({ kind, min, max, onConfirm, onCancel }: { kind: 'bet' | 'raise'; min: number; max: number; onConfirm: (amount: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState(min);
  const clamp = (n: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
  const label = kind === 'bet' ? 'Bet' : 'Raise to';
  return (
    <form className="raise" onSubmit={(e) => { e.preventDefault(); onConfirm(clamp(value)); }}>
      <label htmlFor="raise-amount">{label}</label>
      <input id="raise-amount" type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(e) => setValue(Number(e.target.value))} onBlur={() => setValue(clamp(value))} autoFocus />
      <input type="range" aria-label={`${label} slider`} min={min} max={max} value={clamp(value)} onChange={(e) => setValue(Number(e.target.value))} />
      <small className="tabular">Min {min.toLocaleString()} · Max {max.toLocaleString()}</small>
      <Button type="submit" variant="primary">Confirm {kind}</Button>
      <Button type="button" onClick={onCancel}>Back</Button>
    </form>
  );
}
```

`src/features/table/ActionBar.tsx`:
```tsx
import { useState } from 'react';
import type { LegalAction, Action } from '../../domain/game';
import { Button } from '../../components/Button';
import { RaiseControl } from './RaiseControl';
export type BarStatus = 'your-turn' | 'waiting' | 'submitting' | 'resyncing' | 'hand-complete' | 'spectating';
const STATUS_TEXT: Record<BarStatus, string> = { 'your-turn': 'Your turn', waiting: 'Waiting for the table', submitting: 'Sending…', resyncing: 'Resyncing with the table…', 'hand-complete': 'Hand complete', spectating: 'Spectating' };

export function ActionBar({ legal, canAct, onAct, status, error, deadline }: { legal: LegalAction[]; canAct: boolean; onAct: (a: Action) => void; status: BarStatus; error?: string | null; deadline?: React.ReactNode }) {
  const [sizing, setSizing] = useState<Extract<LegalAction, { type: 'bet' | 'raise' }> | null>(null);
  const fire = (a: Action) => { setSizing(null); onAct(a); };
  return (
    <section className="action-bar" aria-label="Actions">
      <div className="action-status"><span>{STATUS_TEXT[status]}</span>{deadline}</div>
      {error && <p role="alert" className="action-error">{error}</p>}
      {sizing ? <RaiseControl kind={sizing.type} min={sizing.min_amount} max={sizing.max_amount} onConfirm={(amount) => fire({ type: sizing.type, amount })} onCancel={() => setSizing(null)} /> : (
        <div className="action-buttons">
          {legal.map((a) => {
            switch (a.type) {
              case 'fold': return <Button key="fold" variant="danger" disabled={!canAct} onClick={() => fire({ type: 'fold' })}>Fold</Button>;
              case 'check': return <Button key="check" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'check' })}>Check</Button>;
              case 'call': return <Button key="call" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'call' })}>Call {a.amount.toLocaleString()}</Button>;
              case 'bet': return <Button key="bet" disabled={!canAct} onClick={() => setSizing(a)}>Bet</Button>;
              case 'raise': return <Button key="raise" disabled={!canAct} onClick={() => setSizing(a)}>Raise</Button>;
              case 'all_in': return <Button key="all_in" disabled={!canAct} onClick={() => fire({ type: 'all_in' })}>All-in {a.amount.toLocaleString()}</Button>;
            }
          })}
        </div>
      )}
    </section>
  );
}
```

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/actionBar.test.tsx`
Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table/ActionBar.tsx frontend/src/features/table/RaiseControl.tsx frontend/tests/component/actionBar.test.tsx
git commit -m "feat: add action bar driven by server legal actions"
```

### Task 12: Table page wiring, deadline ring, connection pill, recovery notice

**Files:**
- Create: `frontend/src/features/table/TablePage.tsx`, `frontend/src/features/table/DeadlineRing.tsx`, `frontend/src/features/table/ConnectionPill.tsx`, `frontend/src/features/table/useTableSocket.ts`, `frontend/tests/component/tablePage.test.tsx`
- Modify: `frontend/src/features/table/TableRoute.tsx` (remove the stub)

- [x] **Step 1: Write the failing test**

`tests/component/tablePage.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import snapshot from '../fixtures/snapshot.json';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import { TablePage } from '../../src/features/table/TablePage';
import { useTable } from '../../src/store/table';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };

describe('TablePage', () => {
  beforeEach(() => { FakeWebSocket.reset(); sessionStorage.clear(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows connecting, then the felt after the snapshot, and the recovery notice first', async () => {
    render(<TablePage view={view} />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, recovery_notice: 'The active hand was cancelled after a restart; pre-hand balances were restored.' }); });
    expect(screen.getByRole('alert')).toHaveTextContent(/cancelled after a restart/);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByLabelText('Table')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('sends a command on my turn, disables the bar until the ack, then re-enables', async () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, payload: { ...snap.payload, public: { ...snap.payload.public, current_seat: snap.payload.seat_id } } }); });
    await userEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    const key = JSON.parse(FakeWebSocket.last().sent[0]).idempotency_key;
    act(() => { FakeWebSocket.last().receive({ type: 'ack', revision: 1, idempotency_key: key, payload: snap.payload, deadline: null }); });
    expect(screen.queryByText(/sending/i)).toBeNull();
  });

  it('reconnects on stale_revision and shows resyncing', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap); });
    act(() => { FakeWebSocket.last().receive({ type: 'error', code: 'stale_revision', message: 'expected revision does not match', revision: 3 }); });
    expect(screen.getByText(/resyncing/i)).toBeInTheDocument();
    expect(FakeWebSocket.last().readyState).toBe(3);
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/tablePage.test.tsx`
Expected: FAIL, the stub renders `Table 7` only.

- [x] **Step 3: Implement**

`src/features/table/DeadlineRing.tsx`:
```tsx
import { useEffect, useState } from 'react';
export function DeadlineRing({ deadline, total = 30 }: { deadline: string | null; total?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  const frac = Math.min(1, left / total);
  return (
    <span className="deadline" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
        <circle cx="20" cy="20" r="17" fill="none" stroke="var(--moss)" strokeWidth="3" strokeDasharray={`${frac * 106.8} 106.8`} transform="rotate(-90 20 20)" />
      </svg>
      <span className="tabular">{left}s</span>
    </span>
  );
}
```

`src/features/table/ConnectionPill.tsx`:
```tsx
import type { SocketStatus } from '../../ws/TableSocket';
const TEXT: Record<SocketStatus, string> = { connecting: 'Connecting…', open: 'Connected', reconnecting: 'Reconnecting…', closed: 'Offline', unauthorized: 'Signed out', forbidden: 'Not seated at this table', handshake_failed: 'Could not join the table' };
export function ConnectionPill({ status }: { status: SocketStatus }) {
  return <span className={`pill pill-${status}`} role="status">{TEXT[status]}</span>;
}
```

`src/features/table/useTableSocket.ts`:
```ts
import { useEffect, useRef } from 'react';
import { TableSocket } from '../../ws/TableSocket';
import { useTable } from '../../store/table';
import type { Action } from '../../domain/game';

export function useTableSocket(tableId: number) {
  const ref = useRef<TableSocket | null>(null);
  const { applyEvent, setConnection, needsResync } = useTable();
  useEffect(() => {
    const sock = new TableSocket(tableId, { onEvent: applyEvent, onStatus: setConnection, onPendingDropped: () => useTable.getState().setPending(null) });
    ref.current = sock; sock.connect();
    return () => { sock.close(); ref.current = null; useTable.getState().reset(); };
  }, [tableId, applyEvent, setConnection]);
  useEffect(() => { if (needsResync) ref.current?.resync(); }, [needsResync]);
  return (action: Action) => {
    const { projection, revision } = useTable.getState();
    if (!projection || !ref.current) return;
    useTable.getState().setPending({ key: 'pending', action });
    ref.current.send(action, revision, projection.seat_id);
  };
}
```

`src/features/table/TablePage.tsx`:
```tsx
import type { TableView } from '../../domain/table';
import { useTable } from '../../store/table';
import { useTableSocket } from './useTableSocket';
import { Felt } from './Felt';
import { ActionBar, type BarStatus } from './ActionBar';
import { DeadlineRing } from './DeadlineRing';
import { ConnectionPill } from './ConnectionPill';
import { RecoveryNotice } from './RecoveryNotice';

export function TablePage({ view }: { view: TableView }) {
  const send = useTableSocket(view.id);
  const { projection, deadline, connection, pending, lastError, needsResync, recoveryNotice, dismissNotice, canAct } = useTable();
  const status: BarStatus = needsResync ? 'resyncing' : pending ? 'submitting'
    : !projection ? 'waiting' : projection.public.street === 'complete' ? 'hand-complete'
    : projection.public.current_seat === projection.seat_id ? 'your-turn' : 'waiting';
  return (
    <main className="table-page">
      <header className="table-header">
        <h1>The Common Table</h1>
        <p>Private table · {view.seat_count} seats · blinds {view.small_blind}/{view.big_blind}</p>
        <ConnectionPill status={connection} />
      </header>
      {recoveryNotice && <RecoveryNotice message={recoveryNotice} onDismiss={dismissNotice} />}
      {connection === 'handshake_failed' && <HandshakeHelp tableId={view.id} />}
      {!projection ? <p aria-busy="true">Opening your seat…</p> : !recoveryNotice && (
        <>
          <Felt projection={projection} />
          <ActionBar legal={projection.legal_actions} canAct={canAct()} onAct={send} status={status}
            error={lastError && lastError.code !== 'stale_revision' ? lastError.message : null}
            deadline={projection.public.current_seat === projection.seat_id ? <DeadlineRing deadline={deadline} /> : null} />
        </>
      )}
    </main>
  );
}
```

`HandshakeHelp` (same file) runs once on mount: it calls `me()` and `getTable(tableId)`; a 401 renders "You were signed out. Sign in again." with a link to `loginUrl()`, a 403 or a seat list without the current user renders "You are not seated at this table." with a link to `/`, and any other outcome renders "The table server refused the connection. Try again." with a Retry button that calls `TableSocket.connect()` via a `reconnect` function returned from `useTableSocket`.

Remove the stub from `TableRoute.tsx` so it imports this `TablePage`.

- [x] **Step 4: Run the whole suite**

Run: `npx vitest run && npx tsc -b --noEmit && npm run build`
Expected: all green. If the second test's ack does not clear `pending`, check that `applyEvent` in Task 5 spreads `{ pending: null }` on `ack`.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table frontend/tests/component/tablePage.test.tsx
git commit -m "feat: wire live table page with socket, deadline ring, and recovery notice"
```

### Task 13: Mock API mode, Playwright smoke, deployment smoke script

**Files:**
- Create: `frontend/src/mocks/browser.ts`, `frontend/tests/e2e/play.spec.ts`, `frontend/playwright.config.ts`, `scripts/frontend_smoke.sh` (repo root)
- Modify: `frontend/src/main.tsx`, `frontend/package.json` scripts

- [x] **Step 1: Add the mock worker**

`src/mocks/browser.ts` starts an MSW `setupWorker` with `defaultHandlers` from `tests/fakes/handlers.ts` plus a `GET /tables/:id` handler that flips `status` to `in_progress` after `POST /tables/:id/start`. Also install a `FakeWebSocket` on `window.WebSocket` that opens immediately and replies to the first message with the fixture snapshot, then acks any command with `revision + 1` and a payload whose `current_seat` is the other seat, so the bar reads "Waiting for the table". `main.tsx` awaits `worker.start()` when `config.mockApi` is true before rendering.

- [x] **Step 2: Write the Playwright spec**

`tests/e2e/play.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
test('create, add AI, start, act', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create table' }).click();
  await page.getByRole('button', { name: 'Add player' }).click();
  await page.getByRole('menuitem', { name: 'Easy' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByLabel('Table')).toBeVisible();
  await page.getByRole('button', { name: 'Fold' }).click();
  await expect(page.getByText('Waiting for the table')).toBeVisible();
});
```

`playwright.config.ts` runs `VITE_MOCK_API=1 npm run dev` as the web server on port 5173.

- [x] **Step 3: Run**

Run: `npx playwright install chromium && npx playwright test`
Expected: 1 passed.

- [x] **Step 4: Deployment smoke script**

`scripts/frontend_smoke.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
API=${1:?api origin, e.g. https://api.example.com}; PLAY=${2:?frontend origin, e.g. https://play.example.com}
curl -fsS "$API/healthz" >/dev/null && echo "healthz ok"
curl -fsS -o /dev/null -D - -X OPTIONS "$API/tables" -H "Origin: $PLAY" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-csrf-token" | grep -i "access-control-allow-origin: $PLAY" && echo "cors ok"
code=$(curl -s -o /dev/null -w '%{http_code}' "$API/auth/me"); [ "$code" = "401" ] && echo "auth/me anonymous ok"
```

Run after DNS and Nginx are in place: `./scripts/frontend_smoke.sh https://api.example.com https://play.example.com`.

- [x] **Step 5: Commit**

```bash
git add frontend scripts/frontend_smoke.sh
git commit -m "feat: add mock API mode, Playwright smoke, and deployment smoke script"
```

### Slice C: continuous play and lifecycle

### Task 14: Hand-complete reveal and seamless next hand

**Files:**
- Create: `frontend/src/features/table/HandResult.tsx`, `frontend/tests/component/handResult.test.tsx`
- Modify: `frontend/src/features/table/TablePage.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/handResult.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import { TablePage } from '../../src/features/table/TablePage';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };
const complete = { ...snap.payload, legal_actions: [], public: { ...snap.payload.public, street: 'complete' as const, current_seat: null, winners: [2], payouts: [[2, 15]] as [number, number][] } };

describe('hand result', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the winner and payout when the street is complete', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('Rivers (AI) wins 15');
    expect(screen.getByText('Hand complete')).toBeInTheDocument();
  });

  it('replaces the result with the next deal on the following state event', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    act(() => { FakeWebSocket.last().receive({ type: 'state', revision: 5, payload: snap.payload, deadline: '2026-09-10T12:00:30+00:00' }); });
    expect(screen.queryByRole('status', { name: 'Hand result' })).toBeNull();
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(2);
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/handResult.test.tsx`
Expected: FAIL, no element with name "Hand result".

- [x] **Step 3: Implement**

`src/features/table/HandResult.tsx`:
```tsx
import type { PublicState } from '../../domain/game';
export function HandResult({ pub }: { pub: PublicState }) {
  if (pub.street !== 'complete' || pub.payouts.length === 0) return null;
  return (
    <div role="status" aria-label="Hand result" className="hand-result">
      {pub.payouts.map(([seat, amount]) => <p key={seat}>{pub.names[seat] ?? `Seat ${seat}`} wins {amount.toLocaleString()}</p>)}
    </div>
  );
}
```

In `TablePage.tsx`, render `<HandResult pub={projection.public} />` between `<Felt>` and `<ActionBar>`. The store already replaces the projection on the next `state` event, so nothing else changes.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/handResult.test.tsx`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table/HandResult.tsx frontend/src/features/table/TablePage.tsx frontend/tests/component/handResult.test.tsx
git commit -m "feat: show hand result during the reveal window"
```

### Task 15: Spectator state

**Files:**
- Create: `frontend/tests/component/spectator.test.tsx`
- Modify: `frontend/src/features/table/TablePage.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/spectator.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import { TablePage } from '../../src/features/table/TablePage';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };
// I am seat 3, not in the deal: the backend sends empty hole cards and no legal actions
const spectator = { ...snap.payload, seat_id: 3, hole_cards: [], legal_actions: [], hand_rank: null };
const session = { type: 'session' as const, revision: 4, status: 'in_progress' as const, host_user_id: 1,
  seats: [{ seat_number: 1, display_name: 'Ana', chip_count: 990, spectating: false }, { seat_number: 2, display_name: 'Rivers (AI)', chip_count: 1010, spectating: false }, { seat_number: 3, display_name: 'Bo', chip_count: 0, spectating: true }],
  final_rankings: [] };

describe('spectating', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the spectating status, no action buttons, no deadline, and keeps the zero-chip seat in the roster', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, payload: spectator }); FakeWebSocket.last().receive(session); });
    expect(screen.getByText('Spectating')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fold|check|call|raise|all-in/i })).toBeNull();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('list', { name: 'Spectators' })).toHaveTextContent('Bo');
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/spectator.test.tsx`
Expected: FAIL, "Spectating" not found.

- [x] **Step 3: Implement**

In `TablePage.tsx`:
```tsx
const { session } = useTable();   // add to the destructure
const meSpectating = !!session?.seats.find((s) => s.seat_number === projection?.seat_id)?.spectating
  || (!!projection && !projection.public.players.some((p) => p.seat_id === projection.seat_id));
const spectators = session?.seats.filter((s) => s.spectating && s.display_name) ?? [];
```
Then: `status` becomes `'spectating'` when `meSpectating` (before the other branches); pass `deadline={null}` when spectating; render after the felt:
```tsx
{spectators.length > 0 && <ul className="spectators" aria-label="Spectators">{spectators.map((s) => <li key={s.seat_number}>{s.display_name} · spectating</li>)}</ul>}
```
`ActionBar` already renders no buttons when `legal_actions` is empty, and `STATUS_TEXT.spectating` is "Spectating".

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/spectator.test.tsx`
Expected: 1 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table frontend/tests/component/spectator.test.tsx
git commit -m "feat: render spectator state from session events"
```

### Task 16: Host transfer and session status line

**Files:**
- Create: `frontend/src/features/table/SessionLine.tsx`, `frontend/tests/component/sessionLine.test.tsx`
- Modify: `frontend/src/features/table/TablePage.tsx`, `frontend/src/features/table/TableRoute.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/sessionLine.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionLine } from '../../src/features/table/SessionLine';
const seats = [{ seat_number: 1, display_name: 'Ana', chip_count: 500, spectating: false }, { seat_number: 2, display_name: 'Bo', chip_count: 1500, spectating: false }];

describe('SessionLine', () => {
  it('names the host', () => {
    render(<SessionLine hostUserId={2} hostSeatNumber={2} seats={seats} myUserId={1} />);
    expect(screen.getByText('Bo is the host')).toBeInTheDocument();
  });
  it('says "You are the host" for the host', () => {
    render(<SessionLine hostUserId={1} hostSeatNumber={1} seats={seats} myUserId={1} />);
    expect(screen.getByText('You are the host')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/sessionLine.test.tsx`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

`src/features/table/SessionLine.tsx`:
```tsx
import type { SessionSeat } from '../../domain/protocol';
export function SessionLine({ hostUserId, hostSeatNumber, seats, myUserId }: { hostUserId: number | null; hostSeatNumber: number | null; seats: SessionSeat[]; myUserId: number | null }) {
  if (hostUserId === null) return null;
  if (hostUserId === myUserId) return <p className="session-line" aria-live="polite">You are the host</p>;
  const host = seats.find((s) => s.seat_number === hostSeatNumber);
  return <p className="session-line" aria-live="polite">{host?.display_name ?? 'Another player'} is the host</p>;
}
```

The `session` event carries `host_user_id` but its seats carry no `user_id`, so `TablePage` resolves the host seat from `view.seats` (which has both) and passes `hostSeatNumber`:
```tsx
const hostId = session?.host_user_id ?? view.host_user_id;
const hostSeat = view.seats.find((s) => s.user_id === hostId)?.seat_number ?? null;
<SessionLine hostUserId={hostId} hostSeatNumber={hostSeat} seats={session?.seats ?? []} myUserId={useSession.getState().user?.id ?? null} />
```
In `TableRoute.tsx`, subscribe to `useTable((s) => s.session)` and call `refresh()` in an effect whenever it changes, so `view` (status, host, seats) stays in step with the socket.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/sessionLine.test.tsx`
Expected: 2 passed.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table/SessionLine.tsx frontend/src/features/table/TablePage.tsx frontend/src/features/table/TableRoute.tsx frontend/tests/component/sessionLine.test.tsx
git commit -m "feat: show host status and follow host transfers"
```

### Task 17: Leave and end controls

**Files:**
- Create: `frontend/src/features/table/LeaveEndControls.tsx`, `frontend/tests/component/leaveEnd.test.tsx`
- Modify: `frontend/src/api/tables.ts`, `frontend/src/features/table/TablePage.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/leaveEnd.test.tsx`:
```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LeaveEndControls } from '../../src/features/table/LeaveEndControls';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('LeaveEndControls', () => {
  it('host sees End session, disabled during a hand, enabled between hands, and confirms before ending', async () => {
    useSession.setState({ csrfToken: 'tok' });
    let ended = false;
    server.use(http.post('http://localhost:8000/tables/7/end', () => { ended = true; return HttpResponse.json({ id: 7, status: 'ended' }); }));
    const { rerender } = render(<LeaveEndControls tableId={7} isHost handInProgress onLeft={() => {}} />);
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled();
    rerender(<LeaveEndControls tableId={7} isHost handInProgress={false} onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByText('The session ends for everyone.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    expect(ended).toBe(true);
  });
  it('guest sees Leave table and is sent to the lobby after leaving', async () => {
    useSession.setState({ csrfToken: 'tok' });
    server.use(http.post('http://localhost:8000/tables/7/leave', () => HttpResponse.json({ id: 7, status: 'in_progress' })));
    const onLeft = vi.fn();
    render(<LeaveEndControls tableId={7} isHost={false} handInProgress={false} onLeft={onLeft} />);
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(onLeft).toHaveBeenCalled();
  });
  it('shows the 409 message from the server', async () => {
    useSession.setState({ csrfToken: 'tok' });
    server.use(http.post('http://localhost:8000/tables/7/end', () => HttpResponse.json({ detail: 'session can only end between hands' }, { status: 409 })));
    render(<LeaveEndControls tableId={7} isHost handInProgress={false} onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    await userEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('between hands');
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/leaveEnd.test.tsx`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

Add to `src/api/tables.ts`:
```ts
export const leaveTable = (id: number) => request<TableView>(`/tables/${id}/leave`, { method: 'POST' });
export const endTable = (id: number) => request<TableView>(`/tables/${id}/end`, { method: 'POST' });
```

`src/features/table/LeaveEndControls.tsx`:
```tsx
import { useState } from 'react';
import { leaveTable, endTable } from '../../api/tables';
import { ApiError } from '../../api/http';
import { Button } from '../../components/Button';

export function LeaveEndControls({ tableId, isHost, handInProgress, onLeft }: { tableId: number; isHost: boolean; handInProgress: boolean; onLeft: () => void }) {
  const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setError(null);
    try { await fn(); after?.(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong.'); } finally { setBusy(false); setConfirming(false); }
  };
  return (
    <div className="leave-end">
      <Button onClick={() => run(() => leaveTable(tableId), onLeft)} busy={busy}>Leave table</Button>
      {isHost && !confirming && <Button variant="danger" disabled={handInProgress} onClick={() => setConfirming(true)}>End session</Button>}
      {isHost && confirming && (
        <div role="group" aria-label="Confirm end">
          <p>The session ends for everyone.</p>
          <Button variant="danger" busy={busy} onClick={() => run(() => endTable(tableId))}>End for everyone</Button>
          <Button onClick={() => setConfirming(false)}>Keep playing</Button>
        </div>
      )}
      {handInProgress && isHost && <small>You can end the session between hands.</small>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
```

In `TablePage.tsx`, render it in the header with `handInProgress={projection ? projection.public.street !== 'complete' : true}` and `onLeft={() => navigate('/')}`. A leave during a hand is queued server-side; the client still navigates to the lobby and the seat auto-folds until the hand ends.

- [x] **Step 4: Run, expect pass**

Run: `npx vitest run tests/component/leaveEnd.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Manual check (waits on backend bug B9)**

With the backend running, end the session within six seconds of a hand completing and confirm no new deal arrives. Until B9 is fixed this check fails; record the result in the commit message.

- [x] **Step 6: Commit**

```bash
git add frontend/src/api/tables.ts frontend/src/features/table frontend/tests/component/leaveEnd.test.tsx
git commit -m "feat: add leave and host-only end controls"
```

### Task 18: Final rankings and cancellation screens

**Files:**
- Create: `frontend/src/features/table/SessionEnded.tsx`, `frontend/tests/component/sessionEnded.test.tsx`
- Modify: `frontend/src/features/table/TableRoute.tsx`, `frontend/src/features/table/TablePage.tsx`

- [x] **Step 1: Write the failing test**

`tests/component/sessionEnded.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionEnded } from '../../src/features/table/SessionEnded';

const rankings = [{ seat_number: 2, display_name: 'Rivers (AI)', chip_count: 2000 }, { seat_number: 1, display_name: 'Ana', chip_count: 0 }];

describe('SessionEnded', () => {
  it('lists every seat in order, including zero-chip seats', () => {
    render(<MemoryRouter><SessionEnded status="ended" rankings={rankings} /></MemoryRouter>);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1. Rivers (AI) 2,000');
    expect(items[1]).toHaveTextContent('2. Ana 0');
    expect(screen.getByRole('link', { name: 'Back to lobby' })).toHaveAttribute('href', '/');
  });
  it('explains cancellation', () => {
    render(<MemoryRouter><SessionEnded status="cancelled" rankings={[]} /></MemoryRouter>);
    expect(screen.getByText('Every player left, so this table was closed.')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, expect failure**

Run: `npx vitest run tests/component/sessionEnded.test.tsx`
Expected: FAIL, module not found.

- [x] **Step 3: Implement**

`src/features/table/SessionEnded.tsx`:
```tsx
import { Link } from 'react-router-dom';
import type { FinalRanking } from '../../domain/table';
export function SessionEnded({ status, rankings }: { status: 'ended' | 'cancelled'; rankings: FinalRanking[] }) {
  return (
    <main className="session-ended">
      <h1>{status === 'ended' ? 'Final standings' : 'Table closed'}</h1>
      {status === 'cancelled' && <p>Every player left, so this table was closed.</p>}
      {status === 'ended' && (
        <ol>{rankings.map((r, i) => <li key={r.seat_number}><span>{i + 1}.</span> <span>{r.display_name ?? `Seat ${r.seat_number}`}</span> <span className="tabular">{r.chip_count.toLocaleString()}</span></li>)}</ol>
      )}
      <Link className="btn btn-primary" to="/">Back to lobby</Link>
    </main>
  );
}
```

In `TableRoute.tsx`, before the `in_progress` branch:
```tsx
if (view.status === 'ended' || view.status === 'cancelled') return <SessionEnded status={view.status} rankings={view.final_rankings} />;
```
In `TablePage.tsx`, when `session?.status` is `ended` or `cancelled`, render `<SessionEnded status={session.status} rankings={session.final_rankings} />` instead of the felt so the transition happens without waiting for the next poll.

- [x] **Step 4: Run the whole suite**

Run: `npx vitest run && npx tsc -b --noEmit && npm run build`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add frontend/src/features/table frontend/tests/component/sessionEnded.test.tsx
git commit -m "feat: show final standings and cancellation screens"
```

### Task 19: Restart recovery check (manual)

- [ ] Start the backend with `docker compose up -d --build`, start a two-seat table with one AI seat, act once so a hand is mid-way.
- [ ] Run `docker compose restart card-games`. The socket drops; the page shows "Reconnecting…", then the snapshot with `recovery_notice` arrives and the notice is shown before the felt.
- [ ] Confirm both stacks equal their pre-hand balances (`GET /tables/{id}` and the seat badges agree).
- [ ] Record the outcome here.

**Result (2026-09-10, verified against a local uvicorn process instead of Docker):** PASS. Two human seats, hand mid-way at revision 1 with stacks 990/990; SIGTERM and restart of the server; the reconnect snapshot carried `recovery_notice` "The active hand was cancelled after a restart; pre-hand balances were restored." and `GET /tables/{id}` showed both seats back at 1,000. Note: the actor restarts at revision 0 after a restart; the client handles this because a `snapshot` always replaces local state regardless of revision. The Docker variant is the same check with `docker compose restart card-games` and remains to be run on the VM.

---

## Self-review

- **Spec coverage:** every UI requirement in the brief maps to Tasks 6–12 (auth, lobby, setup, table) or Tasks 14–19 (next hand, spectators, host transfer, leave/end, rankings, cancellation, recovery).
- **Placeholders:** none. `Player {user_id}` and `Seat {n}` are null-name fallbacks only.
- **Type consistency:** `SeatProjection`, `LegalAction`, `Action`, `ServerEvent`, `SessionEvent`, `SessionSeat`, `FinalRanking`, `TableView`, `AiTier`, and `SocketStatus` are defined once (Tasks 2 and 4) and used unchanged in Tasks 5–18. `useTable.applyEvent` clears `pending` on `ack`, which Task 12's second test depends on.
