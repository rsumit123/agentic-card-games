# Backend Gap Closure 2: what the frontend plan needs from the backend

Context: the frontend implementation plan lives at `docs/superpowers/plans/2026-09-10-common-table-frontend.md`. Its Slices A and B can be built against `main` at `7460b84` as-is. Slice C (continuous play, spectators, rankings, host transfer, leave/end) is blocked on the items below. Keep the FastAPI/SQLite architecture, single worker, server-authoritative rules. Add pytest coverage for every item; run `python3 -m pytest -q` before pushing.

Do these in order. B1–B3 and B8 are required. B4–B7 are optional.

## B1 (required): hand-to-hand progression, Hand rows, chip writeback

Verified today:
- After a hand reaches `street == "complete"` nothing starts the next hand. `RoomManager.run_once` (`app/rooms/manager.py:97`) only handles timeouts and AI turns.
- No code constructs `Hand(...)`. `grep -rn "Hand(" app` returns only the model. So `recover_incomplete_hands` (`app/rooms/recovery.py:22`) never finds an active hand, and restart recovery is a no-op.
- `Seat.chip_count` is written only at create/join/AI-fill time (`app/rooms/service.py`). A restart resets stacks to the starting chips.
- `lifecycle.finish_hand` (`app/rooms/lifecycle.py:63`) has no caller.

Required behaviour:
1. At every hand start (including the first, in `ensure_actor_for_table`), insert a `Hand` row with `status="active"` and `pre_hand_balances={seat_number: chips}`. Use seat numbers as keys, matching the recovery code's first lookup branch.
2. When a transition produces `street == "complete"`: mark the `Hand` finished, write each player's stack back to `Seat.chip_count` and `is_funded`, call `lifecycle.finish_hand`, and persist the resulting session status.
3. Start the next hand after a reveal delay (proposed 6 seconds, configurable via `HAND_REVEAL_SECONDS`, default 6) using `HoldemModule.next_hand` / `start_hand` with the surviving stacks and rotated dealer. Seats with zero chips are excluded from the deal but stay in the table.
4. Publish the new hand's projections to every connected seat as a `state` event with the new `revision` and `deadline`. Revision must keep increasing across hands (never reset to 0).
5. If fewer than two funded seats remain, do not start a new hand; set the table `status="ended"` and emit the `session` event from B3.

Frontend expectation: the client never has to reload between hands. It replaces its projection on every `state` event with a higher revision.

## B2 (required): display names in seat views and projections

Verified today: `SeatView` (`app/rooms/service.py:71`) carries `seat_number, user_id, actor_type, ai_tier, chip_count`. `public.players` carries only engine fields.

Required:
- Add `display_name: str | None` to `SeatView` (human seats: `User.display_name`; AI seats: a server-chosen name such as `"Rivers (AI)"` or `f"{ai_tier} player"`; empty seats: `null`).
- Add the same `display_name` to each entry of `public.players` in `app/games/holdem/engine.py:public_projection`, or add a top-level `names: {seat_id: display_name}` map to the snapshot. Either is fine; say which in the commit.
- Do not add email or google_subject to any table payload.

## B3 (required): lifecycle routes and a session event

Verified today: `app/rooms/lifecycle.py` (leave, host transfer, spectators, end, final rankings, all-human cancellation) is imported by nothing in `app/routes` or `app/rooms/manager.py`.

Required routes (all need session cookie + `X-CSRF-Token`; errors via the existing `_error` mapping):
- `POST /tables/{id}/leave` — uses `leave_between_hands`. During a hand it queues the leave; between hands it applies immediately. Returns the updated `TableView`.
- `POST /tables/{id}/end` — host only, between hands only (`end_session`), else 409 with `detail="session can only end between hands"`.

Required data on `GET /tables/{id}` (`TableView`):
- `status` including `"ended"` and `"cancelled"`.
- `host_user_id` reflecting transfers.
- `final_rankings: [{seat_number, display_name, chip_count}]` ordered by chips desc, present when `status == "ended"`, else `[]`.
- Per seat: `spectating: bool` (zero chips or not present).

Required WebSocket event, sent to every connected seat whenever any of the above changes:
```json
{"type": "session", "revision": 12, "status": "in_progress", "host_user_id": 3,
 "seats": [{"seat_number": 1, "display_name": "Ana", "chip_count": 0, "spectating": true}],
 "final_rankings": []}
```

## B8 (required): WebSocket close codes must reach the browser

Verified today: `app/routes/ws.py:19` and `:23` call `websocket.close(4403)` / `close(4401)` before `await websocket.accept()`. Uvicorn's websockets implementation turns a close before accept into an HTTP 403 handshake rejection (`uvicorn/protocols/websockets/websockets_impl.py`, the `"websocket.close"` branch sets `initial_response = (403, ...)`). Browsers therefore see `onclose` with code 1006 and cannot tell "signed out" from "not seated". Starlette's in-process `TestClient` does see the code, so the current tests pass anyway.

Required: `await websocket.accept()` first, then `await websocket.close(code=4401)` / `4403`. Keep the Origin check before accept only if you also accept-then-close there; the frontend treats all three the same way. Add a test that uses a real uvicorn server (or asserts the accept happens before close) rather than the in-process client.

## B4 (optional): echo `idempotency_key` on error events

Error events (`app/routes/ws.py:60`, `:87`) carry no key. The frontend therefore allows one in-flight command at a time. Adding `"idempotency_key"` to error events lets it relax that.

## B5 (optional): `return_to` on login for Vercel previews

`GET /auth/login?return_to=https://...` — accept only if the origin is in `settings.allowed_origins`; store it in the session beside `oauth_state`; redirect there after callback instead of `FRONTEND_URL`. Without this, preview deployments cannot complete sign-in.

## B6 (optional): pre-start WebSocket for the lobby

`ws.py:28` refuses connections when no actor exists, so the setup screen polls `GET /tables/{id}` every 2 s. Accepting the socket in `lobby` status and publishing a `table` event on seat changes removes the polling.

## B7 (optional): non-blocking AI turns

`run_once` awaits `adapter.decide` inline inside `run_forever`, so one slow AI call stalls timeouts for every table. Run each AI decision as its own task keyed by `(table_id, seat_id, revision)`, which `_ai_inflight` already tracks.

## Contract the frontend already relies on (do not change)

- Snapshot shape: `{type, revision, payload: {public, hole_cards, seat_id, legal_actions, hand_rank}, deadline, recovery_notice}`.
- `ack` carries the submitter's projection and `deadline`; `state` carries each recipient's own projection.
- `bet`/`raise` amounts are raise-to totals bounded by `min_amount`/`max_amount`.
- AI tiers are the exact strings `Easy`, `Medium`, `Hard`. Seats are 1-based, host is seat 1.
- Error codes `stale_revision`, `invalid_action`, `persistence_failed`.
- A frontend fixture test will be added at `tests/test_frontend_fixture.py` that compares projection keys to `frontend/tests/fixtures/snapshot.json`; when you add keys (B2), regenerate that fixture in the same commit if it exists.

## Follow-up after e5df08f (verified 2026-09-10)

B1, B2, B3, B4, B5, B8 confirmed in code; 73 tests pass. One bug remains:

**B9 (required): the next hand is still dealt after `end` or `leave` during the reveal window.**
`RoomManager.end` and `leave` (`app/rooms/manager.py:177-202`) update `_session_states` and persist `status="ended"`/`"cancelled"`, but never clear `_reveal_deadlines[table_id]`, and `_start_next_hand` (`:251`) never checks `state.status`. When the reveal deadline passes, `run_once` deals a new hand and records a second active `Hand` row while the table row says `ended`.

Repro (pytest, using the same setup as `test_completed_hand_writes_back_chips_and_starts_next_hand_after_reveal`): fold to complete the hand, call `manager.end(table_id, host_id)`, advance the clock 7 s, `asyncio.run(manager.run_once(table_id))`, then assert `actor.state.street == "complete"` and only one `Hand` row exists. Today the street becomes `preflop`.

Fix: in `_start_next_hand`, return early unless `state.status == "in_progress"`; in `end` and `leave`, pop `_reveal_deadlines[table_id]` whenever the resulting status is not `in_progress`. Add the repro as a test.
