# Private Card Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-container FastAPI service for private, play-money, two-to-four-seat Texas Hold'em tables with human and OpenRouter AI seats.

**Architecture:** FastAPI owns OIDC sessions, HTTP and WebSocket transport. A single-process room manager serializes every table transition and delegates rules to a pure, deterministic Hold'em engine that produces recipient-specific projections. SQLite on a mounted volume stores durable metadata and recoverable hand state; active rooms remain in process memory.

**Tech Stack:** Python 3.12, FastAPI, Uvicorn (one worker), SQLAlchemy/Alembic, SQLite WAL, Pydantic, pytest, httpx, WebSocket test client, Docker, Google OpenID Connect, OpenRouter HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-09-private-card-table-design.md`

## Global Constraints

- One FastAPI Docker container behind the existing VM Nginx; expose one local-only port and mount `/app/data`.
- Run one Uvicorn worker; SQLite uses WAL and a busy timeout.
- No real-money, rebuys, public tables, password authentication, or AI authority over game state.
- Tables have exactly 2, 3, or 4 filled seats before start; every mutation carries expected revision and idempotency key.
- Use secure random bytes for shuffling and room-code generation; never send canonical state or another seat's hole cards.
- Auto-fold every human or AI turn at its deadline. Persist recovery state before acknowledgement; restart cancels incomplete hands and restores pre-hand balances with a notice.

---

### Task 1: Service skeleton, configuration, and durable database

**Files:** Create `app/main.py`, `app/settings.py`, `app/db.py`, `app/models.py`, `app/health.py`, `tests/test_health.py`, `Dockerfile`, `docker-compose.yml`, `.env.example`, `requirements.txt`.

**Interfaces:** Produce `create_app() -> FastAPI`, `Settings`, `get_session()`, and SQLAlchemy models `User`, `Table`, `Seat`, `Hand`, `RoomEvent`.

- [ ] Write `tests/test_health.py` asserting `GET /healthz` returns `200` and `{\"status\": \"ok\"}`.
- [ ] Run `pytest tests/test_health.py -v`; expect failure because `app.main` does not exist.
- [ ] Implement `create_app`, a `/healthz` router, settings loaded from environment, SQLite engine configured for WAL and busy timeout, and a startup migration check.
- [ ] Add Docker startup command `uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1`; mount `./data:/app/data` in Compose.
- [ ] Run `pytest tests/test_health.py -v` and `docker compose config`; expect both to pass.
- [ ] Commit: `feat: scaffold FastAPI service and SQLite storage`.

### Task 2: Google identity and secure session boundary

**Files:** Create `app/auth.py`, `app/routes/auth.py`, `tests/test_auth.py`; modify `app/main.py`, `app/models.py`.

**Interfaces:** Produce `require_user(request) -> AuthenticatedUser`, `verify_google_id_token(token) -> GoogleClaims`, and `POST /auth/logout`.

- [ ] Write tests with a mocked token verifier: invalid issuer/audience/state/nonce is rejected; a valid Google subject creates or loads one user; logout clears the secure session.
- [ ] Run `pytest tests/test_auth.py -v`; expect import failure.
- [ ] Implement OIDC authorization-code flow with state and nonce in secure session storage, issuer/audience validation, HTTPS-only HttpOnly SameSite session cookies, CSRF protection for HTTP mutations, and WebSocket Origin validation.
- [ ] Run the auth tests and verify no token, room code, or provider secret is logged.
- [ ] Commit: `feat: add Google OIDC session authentication`.

### Task 3: Generic room persistence and private lobby API

**Files:** Create `app/rooms/store.py`, `app/rooms/service.py`, `app/routes/tables.py`, `tests/test_tables.py`; modify `app/models.py`.

**Interfaces:** Produce `create_table(host_id, config) -> TableView`, `join_table(user_id, code) -> TableView`, `TableConfig(seat_count, starting_chips, small_blind, big_blind)`, and `TableStatus`.

- [ ] Write tests proving a host can create a 2/3/4-seat table, room codes are stored only as hashes, unauthorized/expired/rate-limited joins fail, and one user cannot occupy two seats.
- [ ] Run `pytest tests/test_tables.py -v`; expect failure.
- [ ] Implement high-entropy expiring codes, membership persistence, supported configuration choices with defaults, host-only configuration, and join closure when starting.
- [ ] Run the tests plus an API smoke test with an authenticated fixture.
- [ ] Commit: `feat: add private table lobby and room-code access`.

### Task 4: Pure game contracts and card primitives

**Files:** Create `app/games/contracts.py`, `app/games/cards.py`, `app/games/holdem/state.py`, `tests/games/test_cards.py`, `tests/games/test_contracts.py`.

**Interfaces:** Define `GameModule.setup`, `legal_actions`, `transition`, `seat_projection`, `public_projection`, `timeout_action`, `ai_schema`; define immutable `Card`, `SeatId`, `GameState`, `Transition`.

- [ ] Write tests for a 52-card unique deck and deterministic shuffle given injected random bytes.
- [ ] Run `pytest tests/games/test_cards.py -v`; expect failure.
- [ ] Implement card values, CSPRNG-backed shuffle adapter, generic opaque game state contracts, and projection interfaces with configurable seat count and ruleset version.
- [ ] Run both game-contract test modules; expect pass.
- [ ] Commit: `feat: add generic game contracts and card primitives`.

### Task 5: Hold'em rules engine and invariants

**Files:** Create `app/games/holdem/engine.py`, `app/games/holdem/evaluator.py`, `app/games/holdem/actions.py`, `tests/games/test_holdem_engine.py`, `tests/games/test_holdem_evaluator.py`.

**Interfaces:** Produce `HoldemModule`, `start_hand`, `legal_actions`, `apply_action`, `resolve_showdown`; actions are `fold`, `check`, `call`, `bet`, `raise`, `all_in`.

- [ ] Write failing examples for dealer/blind rotation, pre-flop through river turns, legal raise bounds, all-ins, side pots, ties, and rank evaluation.
- [ ] Run each focused pytest node; expect failure.
- [ ] Implement standard no-limit Hold'em transitions and evaluator using integer chip units; preserve chip-total invariants and reject out-of-turn, duplicate, and stale actions.
- [ ] Add property tests asserting no negative stack, no duplicated card, and total chips conserved across randomly generated legal actions.
- [ ] Run `pytest tests/games -v`; expect pass.
- [ ] Commit: `feat: implement deterministic no-limit Holdem engine`.

### Task 6: Authoritative room actor, snapshots, timers, and recovery

**Files:** Create `app/rooms/actor.py`, `app/rooms/protocol.py`, `app/rooms/recovery.py`, `tests/rooms/test_actor.py`, `tests/rooms/test_recovery.py`.

**Interfaces:** Produce `RoomActor.submit(command) -> Ack|CommandError`, `RoomActor.snapshot_for(seat_id)`, `recover_incomplete_hands(session)`, and envelopes with `expected_revision` and `idempotency_key`.

- [ ] Write tests for serial transition ordering, idempotency replay, stale revision rejection, seat-specific snapshot secrecy, reconnect resync, and auto-fold under fake clock.
- [ ] Write restart test: start a hand, persist transition, simulate restart, restore pre-hand balances once, mark hand cancelled, and expose recovery notice.
- [ ] Run the focused tests; expect failure.
- [ ] Implement per-table single writer, short SQLite transactions before acknowledgement/fan-out, server deadlines, full reconnect snapshots, and exactly-once overdue recovery.
- [ ] Run `pytest tests/rooms -v`; expect pass.
- [ ] Commit: `feat: add authoritative rooms, timers, and restart recovery`.

### Task 7: WebSocket table protocol and session lifecycle

**Files:** Create `app/routes/ws.py`, `app/rooms/lifecycle.py`, `tests/test_websocket_table.py`.

**Interfaces:** Produce `WSCommand(table_id, expected_revision, idempotency_key, action)`, `WSEvent(type, revision, payload)`, `start_table`, `leave_between_hands`, `end_session`.

- [ ] Write WebSocket tests for join/start only after all selected seats are filled, human action acknowledgement, projection isolation, and dropped-event resynchronization.
- [ ] Add lifecycle tests for zero-chip spectators, two funded seats minimum, final chip ranking, explicit all-human departure cancellation, and next-human host transfer after the current hand.
- [ ] Run `pytest tests/test_websocket_table.py -v`; expect failure.
- [ ] Wire route events into `RoomActor`, enforce WebSocket Origin and membership checks, and implement lifecycle behavior.
- [ ] Run the WebSocket and room suites; expect pass.
- [ ] Commit: `feat: add live private tables and session lifecycle`.

### Task 8: OpenRouter AI adapter and tier policy

**Files:** Create `app/ai/policy.py`, `app/ai/openrouter.py`, `app/ai/adapter.py`, `tests/ai/test_adapter.py`, `tests/ai/test_policy.py`.

**Interfaces:** Produce `TierPolicy`, `decide(seat_projection, legal_schema, revision, deadline) -> ProposedAction`, and `validate_ai_reply`.

- [ ] Write tests using fake provider replies: only seat-safe projection is sent, structured action is validated, stale replies are discarded, and timeout/invalid output folds.
- [ ] Write policy tests that Easy/Medium/Hard persist model pool, prompt/schema version, sampling, token/latency budget, and fallback chain, locked for the hand.
- [ ] Run `pytest tests/ai -v`; expect failure.
- [ ] Implement asynchronous provider invocation outside room writer, deadline-bounded retry, redacted logs, restrictive provider configuration, and enqueued revision-checked reply.
- [ ] Run AI plus room tests; expect pass.
- [ ] Commit: `feat: add safe OpenRouter AI seats`.

### Task 9: Operations, migrations, and verification

**Files:** Create `alembic/`, `scripts/backup_sqlite.sh`, `scripts/restore_check.sh`, `tests/test_deployment.py`; modify `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.

**Interfaces:** Produce documented environment settings, migration command, health check, backup command, and Nginx WebSocket proxy requirements.

- [ ] Write deployment checks asserting one worker, mounted data path, no secrets in image, and health endpoint.
- [ ] Add restore-check test that restores a backup to a temporary SQLite file and reads expected records.
- [ ] Run deployment and restore tests; expect failure.
- [ ] Implement migrations, health probe, graceful drain, backup/restore scripts, restart policy, resource limits, and README deployment instructions including TLS/WebSocket Nginx headers.
- [ ] Run `pytest -v`, `docker compose config`, image build, and a container health smoke test; expect pass.
- [ ] Commit: `feat: harden single-container deployment`.

## Plan self-review

- Spec coverage: Tasks 1–3 cover deployment, identity, and private access; 4–5 cover generic and Hold'em rules; 6–7 cover transport, recovery, and lifecycle; 8 covers AI safety; 9 covers operations and backups.
- Placeholder scan: no deferred requirements or generic error-handling steps remain.
- Type consistency: `GameModule` feeds `RoomActor`; `RoomActor` owns protocol revision checks; `TierPolicy` and `decide` feed only the actor's AI-turn path.
