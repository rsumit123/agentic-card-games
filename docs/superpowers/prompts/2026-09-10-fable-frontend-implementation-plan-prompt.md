# Fable Prompt: The Common Table Frontend Implementation Plan

You are a senior product designer and frontend architect. Review the repository at:

https://github.com/rsumit123/agentic-card-games

Inspect the latest `main` commit; this prompt was updated after the backend gap-closure work described below.

Your task is to produce a detailed implementation plan for the frontend and the frontend/backend integration. Do not write code yet. Inspect the repository and existing specification files first.

## Product

The Common Table is a private, play-money Texas Hold’em web application.

Users sign in with Google, create or join private rooms using short room codes, and play casual no-limit Texas Hold’em against humans and/or AI players. Tables support 2, 3, or 4 seats.

The server must remain authoritative for all game rules, revisions, timers, chip balances, card secrecy, AI validation, and recovery behavior.

## Existing backend

The backend is FastAPI/Python with:

- SQLite using WAL mode
- SQLAlchemy models
- Google OIDC session authentication
- Private room-code lobby
- Deterministic Hold’em engine
- Per-seat projections
- Authoritative room actor
- Idempotency and revision checks
- WebSocket table protocol
- OpenRouter AI adapter
- Restart recovery
- Docker deployment
- Alembic and SQLite backup scripts

The existing backend currently lives at the repository root under `app/`, with:

- `app/main.py`
- `app/auth.py`
- `app/models.py`
- `app/db.py`
- `app/routes/auth.py`
- `app/routes/tables.py`
- `app/routes/ws.py`
- `app/rooms/`
- `app/games/holdem/`
- `app/ai/`
- `alembic/`
- `tests/`

The desired eventual repository layout is:

```text
backend/
  app/
  alembic/
  scripts/
  tests/
  requirements.txt
  Dockerfile
  docker-compose.yml

frontend/
  package.json
  src/
  public/
  tests/
  vercel.json
```

Preserve the FastAPI/SQLite architecture. Do not replace it with Node, Postgres, Redis, Firebase, Supabase, or another backend architecture. Treat moving the existing backend into `backend/` as a separately approved migration slice because it changes Docker, Compose, Alembic, pytest, and VM deployment paths.

## Current HTTP API

Existing endpoints include:

```text
GET /healthz
GET /auth/login
GET /auth/callback?code=...&state=...
POST /auth/logout
POST /tables
POST /tables/join
```

`POST /auth/logout` requires an `X-CSRF-Token` header and an authenticated session cookie.

Table creation accepts approximately:

```json
{
  "seat_count": 2,
  "starting_chips": 1000,
  "small_blind": 5,
  "big_blind": 10
}
```

Supported seat counts are 2, 3, and 4. Supported starting chips are 1000, 5000, and 10000. Supported small blinds are 5, 10, and 25, with the big blind twice the small blind.

Joining accepts:

```json
{
  "code": "PRIVATE_ROOM_CODE"
}
```

The backend stores only a hash of the room code.

## Current WebSocket API

WebSocket endpoint:

```text
/ws/tables/{table_id}
```

The browser must send the backend Origin and authenticated session cookie.

The initial server event is:

```json
{
  "type": "snapshot",
  "revision": 0,
  "payload": {
    "public": {
      "street": "preflop",
      "community_cards": [],
      "pot": 15,
      "current_seat": 1,
      "dealer_seat": 1,
      "small_blind_seat": 1,
      "big_blind_seat": 2,
      "small_blind": 5,
      "big_blind": 10,
      "current_bet": 10,
      "min_raise": 10,
      "winners": [],
      "payouts": [],
      "players": []
    },
    "hole_cards": [{"rank": 14, "suit": "spades"}, {"rank": 9, "suit": "hearts"}],
    "seat_id": 1,
    "legal_actions": [{"type": "fold"}, {"type": "call", "amount": 5}],
    "hand_rank": null
  },
  "deadline": "2026-09-10T12:00:30Z",
  "recovery_notice": null
}
```

`public.players` entries include `seat_id`, `stack`, `folded`, `all_in`, `contribution`, `street_contribution`, and `has_acted`. The seat projection is private to the authenticated seat: `hole_cards`, `legal_actions`, and `hand_rank` must never be copied into another recipient’s payload. Cards serialize as `{rank, suit}` objects and deadlines serialize as ISO timestamps.

Commands contain:

```json
{
  "expected_revision": 0,
  "idempotency_key": "client-generated-unique-key",
  "action": {
    "type": "call"
  }
}
```

Supported action types:

```text
fold
check
call
bet
raise
all_in
```

Acknowledgements look like:

```json
{
  "type": "ack",
  "revision": 1,
  "idempotency_key": "client-generated-unique-key",
  "payload": {},
  "deadline": "..."
}
```

Other seats receive:

```json
{
  "type": "state",
  "revision": 1,
  "payload": {},
  "deadline": "..."
}
```

The table setup HTTP endpoints are:

```text
GET /tables/{table_id}
POST /tables/{table_id}/start
POST /tables/{table_id}/seats/{seat_number}/ai
```

Mutating table endpoints require the authenticated session cookie and `X-CSRF-Token`. `GET /auth/me` is the frontend bootstrap call for the current user and CSRF token.

Errors conceptually look like:

```json
{
  "type": "error",
  "code": "stale_revision",
  "message": "...",
  "revision": 1
}
```

The frontend must:

- Generate idempotency keys for user actions
- Track the latest revision
- Reject or reconcile stale local state
- Reconnect automatically
- Request/use a full seat-specific snapshot after reconnect
- Never assume a missed event can be safely replayed locally
- Never expose another player’s hole cards
- Never receive or render canonical server state

## Backend integration status and remaining review

The original backend foundation had the following gaps. The gap-closure pass addressed them, but the frontend plan must verify behavior and identify any remaining edge cases:

1. Browser session/CSRF bootstrap: implemented as `/auth/me`; verify logout and all mutations.
2. Host-only start and AI seat routes: implemented; verify authorization, validation, and idempotent UI handling.
3. Stable projection/event serialization: implemented; plan TypeScript types from the actual nested shape.
4. Actor registration and background driving: implemented for startup/restored tables and newly started tables; verify multi-process assumptions and failure handling.
5. Per-seat fan-out and recovery notices: implemented; verify reconnect, ordering, duplicate connections, and secrecy.
6. CORS, credentialed cookies, WebSocket Origin validation, and frontend callback redirects: implemented with explicit configuration; verify Vercel preview/production configuration.
7. API error contracts: verify the current status codes/details and call out any frontend-friendly normalization still needed.

Do not silently assume any behavior beyond these contracts. Inspect the implementation and clearly distinguish verified behavior, remaining backend work, and frontend work.

## Deployment architecture

The frontend must deploy to Vercel.

The backend must remain a Docker container on an existing GCP VM that also hosts other projects.

Expected deployment shape:

```text
Browser
  |
  | HTTPS / WSS
  v
Vercel frontend
  |
  | credentialed HTTPS API requests
  | authenticated WebSocket connection
  v
Backend public subdomain
  |
  v
VM Nginx reverse proxy
  |
  v
127.0.0.1:8000
  |
  v
Single FastAPI/Uvicorn Docker container
  |
  v
Mounted SQLite data directory
```

The frontend should use environment variables such as:

```text
VITE_API_BASE_URL=https://api.example.com
VITE_WS_BASE_URL=wss://api.example.com
```

No backend secrets may be exposed to Vercel or bundled into frontend JavaScript.

Plan for:

- Exact frontend-origin CORS allowlisting
- Credentialed `fetch`
- Secure HttpOnly session cookies
- CSRF protection
- WebSocket `Origin` validation
- TLS termination at Nginx
- WebSocket upgrade headers
- Routing that does not interfere with other projects on the VM
- Backend deployment through a dedicated subdomain or clearly isolated Nginx location
- Vercel preview versus production origins
- Whether `SameSite=None; Secure` is required for the chosen frontend/backend domain arrangement
- No assumption that Vercel can run the FastAPI backend

## UI requirements

Use React, Vite, and TypeScript unless repository inspection reveals a strong reason not to.

Required screens and states:

### Authentication

- Dark restrained landing page
- Google sign-in CTA
- Authenticated session bootstrap
- Logged-out, loading, and authentication-error states

### Lobby/home

- Create private table
- Join by room code
- Clear validation and error states
- Room-code input should be easy to use on mobile
- No public-table discovery

### Table setup/lobby

- Header with private room code and table size
- Seat grid for 2, 3, or 4 seats
- Human occupancy state
- Empty-seat state
- Host-only AI seat controls
- Easy, Medium, and Hard AI selection
- Host-only start control
- Start disabled until all selected seats are filled
- Settings shown clearly but quietly
- Recovery notice if the previous hand was cancelled after restart

### Active table

Follow the documented visual direction:

- Immersive dark-green felt table
- Warm wood frame
- Restrained dark UI language
- Cream/ivory cards
- Copper/gold accents used sparingly
- Recognizable card faces and card backs, never plain rank/suit text
- Community cards visible in one view
- Pot visible
- Seated players visible
- Chip counts visible
- Player-specific hole cards visible only to the recipient
- Active turn clearly indicated
- Action deadline visible
- Compact action bar below table
- Fold
- Context-specific Call or Check
- Raise control with amount/bounds
- All-in handling
- Disabled/loading/submitting states
- Stale revision and rejected action states

### Spectating and lifecycle

- Zero-chip seats remain visible in the roster
- Zero-chip seats are visibly marked as spectators
- Spectators cannot submit actions
- Session ends automatically when fewer than two funded seats remain
- Final rankings show every seat, including zero-chip seats
- Host transfer state is visible
- Host can end only between hands
- Explicit all-human departure cancellation should be represented clearly

### Recovery and reconnect

- Automatic reconnect with backoff
- Full snapshot resynchronization
- Connection status indicator
- Reconnecting state
- Reconnected state
- Recovery notice shown prominently before play resumes
- Do not duplicate actions after reconnect
- Preserve or regenerate idempotency keys safely
- Handle stale revision errors by replacing local state with the server snapshot

## Visual/design expectations

Create a distinctive, intentional visual system rather than a generic dashboard.

Suggested direction:

- Dark forest-green background
- Felt green table surface
- Warm walnut/burnished wood framing
- Ivory paper/card surfaces
- Copper, muted brass, or warm amber accent
- Display serif for The Common Table identity
- Neutral sans-serif for controls and data
- Strong hierarchy between table state and secondary metadata
- Dense but calm information design
- Responsive desktop-first table layout with usable tablet/mobile fallback
- Accessibility-conscious contrast and focus states
- Reduced-motion support
- Keyboard-accessible actions
- Clear status text in addition to color indicators

Avoid:

- Generic SaaS dashboard styling
- Plain white card grids
- Neon casino styling
- Excessive gradients
- Rank/suit text standing in for cards
- Hiding important turn or deadline information
- Client-side game-rule decisions
- Exposing private or canonical state

## Required plan output

Return a detailed implementation plan, not code.

Include:

1. Repository restructuring plan from current root-level backend to `backend/` and `frontend/`, clearly separated into an approved migration slice and frontend slices.
2. Recommended frontend architecture and folder tree.
3. Recommended state-management approach.
4. HTTP client design.
5. WebSocket client/reconnect design.
6. TypeScript domain types matching backend snapshots/events/actions.
7. Required backend endpoint/protocol changes.
8. Authentication, cookies, CORS, CSRF, and WebSocket security plan.
9. Vercel deployment plan.
10. VM Docker/Nginx deployment plan.
11. Environment-variable matrix showing where each variable lives.
12. UI screen/component breakdown.
13. Visual design system: colors, typography, spacing, components, states.
14. Testing strategy:
    - frontend unit tests
    - component tests
    - WebSocket/reconnect tests
    - backend integration tests
    - browser/e2e tests if appropriate
    - deployment smoke tests
15. TDD sequence, with failing tests before implementation for each slice.
16. Migration risks and rollback strategy.
17. Acceptance criteria mapped to the product requirements.
18. Open questions or decisions that require human approval.
19. A task-by-task implementation plan with exact file paths and commit-sized increments.

The plan should be realistic for a small self-managed service and should not introduce unnecessary infrastructure.
