# The Common Table: Private Card Table Design

## Purpose and scope

The Common Table is a browser-based, play-money card-game platform. Version one is a private, four-seat, no-limit Texas Hold'em table. A seat may be occupied by a signed-in human or by an AI player. Public tables, real-money play, deposits, withdrawals, and account-password authentication are out of scope.

The architecture must support later rule modules such as Uno and Go Fish without changing the room, identity, player-seat, or AI-decision foundations.

## User experience

- A user signs in with Google.
- A host creates a private table and receives a short, high-entropy room code.
- Signed-in players with the code join the lobby. The host can fill any remaining seat with an AI player.
- Each AI seat exposes Easy, Medium, and Hard. The server maps those tiers to vetted OpenRouter model pools and operational limits; model names are not shown to hosts.
- The host chooses a two-, three-, or four-seat table, starting chips, and blinds from small supported sets with sensible defaults selected. The host can start only after every selected seat is occupied by a human or AI, and settings lock at the start of play.
- The game uses standard no-limit Texas Hold'em rules. It supports blinds, dealer rotation, all-ins, side pots, split pots, showdowns, and standard hand rankings.
- Every human and AI action has a server-owned deadline. On disconnection, a player can reconnect until their action deadline. A missing or invalid action at expiry auto-folds, even if checking would be legal.
- A table is a casual session, not a tournament: there are no rebuys or eliminations. A player with zero chips remains in the session. When a session ends, it shows all seats ranked by final chip count, including zero-chip seats.
- If the host leaves between hands, host control transfers to the longest-present remaining human. AI seats never become hosts. If every human explicitly leaves the room, the server cancels the table.
- Zero-chip seats remain in the roster and final ranking but spectate future hands. The host may end a session only between hands. Otherwise, play continues while at least two seats have chips and ends automatically when fewer than two remain. A host departure during a hand takes effect after that hand completes.

## Visual direction

The table screen uses an immersive dark-green felt table framed in warm wood. It keeps the community cards, pot, seated players, chip counts, player-specific hole cards, and turn state visible in one view. Cards render as recognizable faces and card backs, never as plain rank-and-suit text. The active player's action bar remains compact beneath the table with Fold, the context-specific Call or Check, and Raise. The private room code and table size sit quietly in the header. Lobby, room setup, AI-seat controls, and recovery notices use the same restrained dark visual language.

## Deployment architecture

Run one Dockerized FastAPI service on the existing GCP VM behind its Nginx reverse proxy. Use a local-only container port when Nginx is on the VM. Mount a host `data` directory into the container so SQLite survives image redeployments. Run exactly one Uvicorn worker.

This first deployment deliberately has one game-server process. Active table state and timers live in that process. SQLite persists user records, table configuration, chip balances, room metadata, and completed-hand events or snapshots. Enable SQLite WAL mode and a busy timeout. The application must take a SQLite write lock seriously: mutations are serialized through the authoritative room process, and database writes are short transactions.

At the start of every hand, persist its pre-hand chip balances and a recoverable hand record. Every accepted state transition persists its room revision, event or snapshot, and current wall-clock action deadline before it is acknowledged or broadcast. On process or VM restart, the server cancels every unfinished hand, restores its pre-hand balances, and records the reason. Returning clients receive a prominent recovery notice before play resumes. Startup processes each overdue hand recovery exactly once.

When traffic requires more than one app instance, migrate persistent data to PostgreSQL and introduce Redis for cross-instance room coordination. This migration does not alter the API or game rules boundary.

## Components and responsibilities

### FastAPI application

Owns Google sign-in integration, authenticated HTTP endpoints, private room-code authorization, WebSocket connections, rate limits, and health checks. It never decides whether a poker move is legal.

### Room manager

Owns a single writer for each active table, connection presence, server timers, reconnection windows, action versions, and outbound fan-out. It invokes the game engine for every mutation and writes durable records after successful transitions. The room actor schedules deadlines; the game module supplies the timeout result. Reconnecting clients receive a full seat-specific snapshot, current revision, and current deadline.

### Deterministic game engine

Owns canonical game state: deck, private cards, public board, blinds, pots, betting, hand evaluation, turn order, and results. It accepts a state and proposed action, returns the next state or a validation error, and produces a separate projection for each seat. The canonical state never leaves the server.

### Game modules

Each module implements game setup, legal-action calculation, state transitions, timeout behavior, scoring or hand completion, public projection, per-seat projection, and AI action schema. The Hold'em module is the first implementation. Shared room lifecycle code must use a game identifier, ruleset version, configurable seat count, and opaque module state/events/actions; it must not contain poker-specific rules.

### AI decision adapter

Requests an action only on an AI seat's turn. It supplies that seat's permitted projection, public table facts, legal action bounds, and a state version. It requires structured output from the configured OpenRouter model. It never blocks the room writer: it works from a captured revision and deadline, then queues its reply for validation. The game engine validates the returned action exactly as it validates a human action and discards replies that are stale. A stale, invalid, or timed-out reply gets at most one retry within the remaining deadline, then folds.

## Data flow and privacy

1. The client sends an authenticated action envelope over WebSocket with table identifier, expected revision, idempotency key, and proposed action.
2. The room manager confirms table membership and current turn.
3. The engine validates and applies the action.
4. The room manager records the transition, updates timers, acknowledges the accepted revision or returns a structured validation error, and sends each connection only its permitted projection. A client that misses events resynchronizes from a full seat-specific snapshot.
5. For an AI turn, the manager obtains a validated action through the AI adapter and repeats the same flow.

Each projection is generated on the server for the intended recipient. No API event may contain another active player's hole cards, full deck order, or internal AI prompt data.

## Reliability and security

- Use cryptographically secure random bytes as an injected shuffle source for the otherwise deterministic engine. Use high-entropy, expiring, hashed room codes with join-attempt rate limits; never place them in server logs or URLs.
- Use monotonically increasing action versions and idempotency keys to prevent duplicate or stale actions during reconnection, retries, and timer races.
- Let the server own all timers. Reconnect and timeout actions compete through the same versioned room transition.
- Use Google OpenID Connect with state and nonce validation, issuer and audience validation, secure session cookies, CSRF protection for HTTP mutations, and WebSocket Origin checks. Enforce one seat per user and persist table membership.
- Do not let OpenRouter models access secrets, canonical state, provider credentials, or another seat's private data. Redact provider-facing logs.
- Restrict AI response latency, token use, sampling, fallback providers, and model pools per difficulty tier. Version and persist the complete tier policy, lock it for the duration of a hand, and calibrate tiers through seeded simulations.

## Testing strategy

Build the pure poker engine first.

- Unit-test legal actions, hand ranking, betting rounds, all-ins, side pots, split pots, and ties.
- Test invalid, duplicate, and stale actions plus disconnect and timeout races.
- Add fake-clock tests for timer races, projection-leak tests, late-AI tests, crash/restart recovery tests, and property tests for engine invariants.
- Integration-test complete human-only, AI-only, and mixed-seat hands through the FastAPI and WebSocket boundaries.
- Run seeded AI-versus-AI simulations to validate action schemas, fallback behavior, state privacy, and difficulty calibration.
- Add deployment health checks, Nginx WebSocket and TLS configuration checks, container restart/resource policy, migrations, and a restore-tested backup routine for the mounted SQLite data directory before production use.

## Initial delivery slices

1. Authentication, private-lobby creation, room-code join, table configuration, and Docker deployment skeleton.
2. Deterministic Hold'em engine with exhaustive rules tests.
3. Live WebSocket table with human seats, reconnect, timers, and auto-fold.
4. OpenRouter AI adapter with Easy, Medium, and Hard tiers.
5. Observability, backups, simulation calibration, and Nginx production routing.
