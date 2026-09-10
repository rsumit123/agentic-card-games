# Prompt: fix B9, then implement the frontend plan

Repository: https://github.com/rsumit123/agentic-card-games, branch `main`, currently at `e5df08f`.

You are executing a written implementation plan. Do not redesign it. Read these two files first, in full:

1. `docs/superpowers/plans/2026-09-10-common-table-frontend.md` — the frontend plan. Sections 1–18 are the design; section 19 is the task list. Every task has a failing test, an implementation, an expected test result, and a commit message.
2. `docs/superpowers/prompts/2026-09-10-backend-gap-closure-2-prompt.md` — read only the last section, "Follow-up after e5df08f", which describes bug B9.

## Part 1: backend bug B9 (do this first, one commit)

The next hand is still dealt after `end` or `leave` during the six-second reveal window. `RoomManager.end` and `leave` in `app/rooms/manager.py` never clear `_reveal_deadlines[table_id]`, and `_start_next_hand` never checks `state.status`.

1. Add a failing test to `tests/rooms/test_backend_gap_closure.py`, modelled on `test_completed_hand_writes_back_chips_and_starts_next_hand_after_reveal`: fold to complete the hand, call `manager.end(table_id, host_id)`, advance the clock 7 seconds, run `manager.run_once(table_id)`, then assert `actor.state.street == "complete"`, the table row status is `"ended"`, and exactly one `Hand` row exists. Add the same shape for `leave` where the leave leaves fewer than two present funded seats.
2. Run it and confirm it fails (street becomes `preflop`).
3. Fix: return early from `_start_next_hand` unless `state.status == "in_progress"`; pop `_reveal_deadlines[table_id]` in `end` and `leave` whenever the resulting status is not `in_progress`.
4. `python3 -m pytest -q` must show 75 passed (73 existing plus the two new tests).
5. Commit: `fix: do not deal a new hand after the session ends during reveal`.

Do not change any request or event shape while doing this. The frontend plan depends on the contract exactly as it is at `e5df08f`.

## Part 2: frontend, Slice A then Slice B (Tasks 1–13)

Work through section 19 of the plan in order, one task at a time, exactly as written:

- Write the test file shown, run it, and confirm it fails for the stated reason before writing implementation code.
- Write the implementation shown. Where the plan says "minimal", keep it minimal; do not add features, libraries, or styling beyond what the task specifies.
- Run the stated command and confirm the stated result. If a test fails for a reason the plan did not predict, fix the code, not the test, unless the test itself is wrong; if you change a test, say so in the commit body and why.
- Commit with the given message after every task. One task per commit.
- All frontend commands run from `frontend/`. Do not move the backend into `backend/`; section 1 of the plan makes that a separate, later slice.

Task 2 generates `frontend/tests/fixtures/snapshot.json` from the backend and adds `tests/test_frontend_fixture.py` at the repository root. Run the backend suite again after Task 2 to confirm that test passes with the rest.

Conventions:

- React 18, Vite 5, TypeScript strict, Zustand 4, react-router 6, Vitest, Testing Library, MSW 2. Pin the versions the plan lists.
- No UI framework, no Tailwind, no component library. Styling is the token system in section 13 and the CSS shown in the tasks.
- The client never decides legality; the action bar renders exactly the server's `legal_actions`.
- Never put the room code in a URL.

Stop after Task 13 and report before starting Slice C.

## Part 3: Slice C (Tasks 14–19), only after Part 1 is merged and Tasks 1–13 are green

Same rules. Task 17 has a manual step that checks the B9 fix end to end; run it with the real backend and record the result in the commit message. Task 19 is manual only; record the result in the plan file under that task.

## Report format

At each stop (after Part 1, after Task 13, after Task 19) reply with:

- commit hashes, one per task;
- output of `python3 -m pytest -q` (root) and `npx vitest run` (frontend), last three lines each;
- any test you changed and why;
- anything in the plan that turned out to be wrong, with the file and line, and what you did instead.

Do not edit `docs/superpowers/plans/2026-09-10-common-table-frontend.md` except to tick checkboxes and to record the Task 19 result.
