import { describe, it, expect, beforeEach, vi } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import { TableSocket } from '../../src/ws/TableSocket';
import type { ServerEvent } from '../../src/domain/protocol';

const raw = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const snap = { ...raw, payload: { ...raw.payload, public: { ...raw.payload.public, current_seat: raw.payload.seat_id } } };
const make = () => {
  const events: ServerEvent[] = [];
  const status: string[] = [];
  let dropped = 0;
  const sock = new TableSocket(7, { WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket, baseUrl: 'ws://t',
    onEvent: (event) => events.push(event), onStatus: (next) => status.push(next), onPendingDropped: () => { dropped += 1; }, random: () => 0.5 });
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
    FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap);
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
