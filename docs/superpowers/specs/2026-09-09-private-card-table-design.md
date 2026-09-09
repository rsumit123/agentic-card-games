# Glass Orchard: Private Card Table Design

## Purpose and scope

Glass Orchard is a browser-based, play-money card-game platform. Version one is a private, four-seat, no-limit Texas Hold'em table. A seat may be occupied by a signed-in human or by an AI player. Public tables, real-money play, deposits, withdrawals, and account-password authentication are out of scope.

The architecture must support later rule modules such as Uno and Go Fish without changing the room, identity, player-seat, or AI-decision foundations.

## User experience

- A user signs in with Google.
- A host creates a private table and receives a short, high-entropy room code.
- Signed-in players with the code join the lobby. The host can fill any remaining seat with an AI player.
- Each AI seat exposes Easy, Medium, and Hard. The server maps those tiers to vetted OpenRouter model pools and operational limits; model names are not shown to hosts.
- The host chooses starting chips and blinds from a small supported set, with sensible defaults selected. Settings lock at the start of play.
- The game uses standard no-limit Texas Hold'em rules. It supports blinds, dealer rotation, all-ins, side pots, split pots, showdowns, and standard hand rankings.
- On disconnection, a player can reconnect until their action deadline. The engine auto-folds when the deadline expires.

## Deployment architecture

Run one Dockerized FastAPI service on the existing GCP VM behind its Nginx reverse proxy. Use a local-only container port when Nginx is on the VM. Mount a host `data` directory into the container so SQLite survives image redeployments.

This first deployment deliberately has one game-server process. Active table state and timers live in that process. SQLite persists user records, table configuration, chip balances, room metadata, and completed-hand events or snapshots. The application must take a SQLite write lock seriously: mutations are serialized through the authoritative room process, and database writes are short transactions.

When traffic requires more than one app instance, migrate persistent data to PostgreSQL and introduce Redis for cross-instance room coordination. This migration does not alter the API or game rules boundary.

## Components and responsibilities

### FastAPI application

Owns Google sign-in integration, authenticated HTTP endpoints, private room-code authorization, WebSocket connections, rate limits, and health checks. It never decides whether a poker move is legal.

### Room manager

Owns a single writer for each active table, connection presence, server timers, reconnection windows, action versions, and outbound fan-out. It invokes the game engine for every mutation and writes durable records after successful transitions.

### Deterministic game engine

Owns canonical game state: deck, private cards, public board, blinds, pots, betting, hand evaluation, turn order, and results. It accepts a state and proposed action, returns the next state or a validation error, and produces a separate projection for each seat. The canonical state never leaves the server.

### Game modules

Each module implements game setup, legal-action calculation, state transitions, timer behavior, scoring or hand completion, public projection, and per-seat projection. The Hold'em module is the first implementation. Shared room lifecycle code must not contain poker-specific rules.

### AI decision adapter

Requests an action only on an AI seat's turn. It supplies that seat's permitted projection, public table facts, legal action bounds, and a state version. It requires structured output from the configured OpenRouter model. The game engine validates the returned action exactly as it validates a human action. A stale, invalid, or timed-out reply gets at most one retry, then resolves through a deterministic fallback such as check when legal or fold.

## Data flow and privacy

1. The client sends an authenticated, versioned action over WebSocket.
2. The room manager confirms table membership and current turn.
3. The engine validates and applies the action.
4. The room manager records the transition, updates timers, and sends each connection only its permitted projection.
5. For an AI turn, the manager obtains a validated action through the AI adapter and repeats the same flow.

Each projection is generated on the server for the intended recipient. No API event may contain another active player's hole cards, full deck order, or internal AI prompt data.

## Reliability and security

- Use cryptographically secure deck shuffling and high-entropy, expiring room codes with join-attempt rate limits.
- Use monotonically increasing action versions and idempotency keys to prevent duplicate or stale actions during reconnection, retries, and timer races.
- Let the server own all timers. Reconnect and timeout actions compete through the same versioned room transition.
- Do not let OpenRouter models access secrets, canonical state, provider credentials, or another seat's private data.
- Restrict AI response latency, token use, and provider fallbacks per difficulty tier. Version the tier configuration independently from gameplay.

## Testing strategy

Build the pure poker engine first.

- Unit-test legal actions, hand ranking, betting rounds, all-ins, side pots, split pots, and ties.
- Test invalid, duplicate, and stale actions plus disconnect and timeout races.
- Integration-test complete human-only, AI-only, and mixed-seat hands through the FastAPI and WebSocket boundaries.
- Run seeded AI-versus-AI simulations to validate action schemas, fallback behavior, state privacy, and difficulty calibration.
- Add deployment health checks and a backup routine for the mounted SQLite data directory before production use.

## Initial delivery slices

1. Authentication, private-lobby creation, room-code join, table configuration, and Docker deployment skeleton.
2. Deterministic Hold'em engine with exhaustive rules tests.
3. Live WebSocket table with human seats, reconnect, timers, and auto-fold.
4. OpenRouter AI adapter with Easy, Medium, and Hard tiers.
5. Observability, backups, simulation calibration, and Nginx production routing.
