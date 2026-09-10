import { setupWorker } from 'msw/browser';
import { http, HttpResponse } from 'msw';
import snapshot from '../../tests/fixtures/snapshot.json';
import { defaultHandlers } from '../../tests/fakes/handlers';
import { FakeWebSocket } from '../../tests/fakes/FakeWebSocket';
import type { ServerEvent } from '../domain/protocol';
import type { TableView } from '../domain/table';

const baseSnapshot = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
let mockTable: TableView = {
  id: 7, room_code: 'ABCD-1234', host_user_id: 1, seat_count: 2 as const, starting_chips: 1000 as const,
  small_blind: 5 as const, big_blind: 10, status: 'lobby' as const, join_expires_at: null,
  seats: [
    { seat_number: 1, user_id: 1, actor_type: 'human' as const, ai_tier: null, chip_count: 1000, display_name: 'Ana', spectating: false },
    { seat_number: 2, user_id: null, actor_type: 'human' as const, ai_tier: null, chip_count: 1000, display_name: null, spectating: true },
  ], final_rankings: [],
};

const mockHandlers = [
  http.get('http://localhost:8000/tables/:id', () => HttpResponse.json(mockTable)),
  http.post('http://localhost:8000/tables/:id/seats/:seat/ai', async ({ request }) => {
    const { tier } = await request.json() as { tier: 'Easy' | 'Medium' | 'Hard' };
    mockTable = { ...mockTable, seats: [mockTable.seats[0], { ...mockTable.seats[1], actor_type: 'ai', ai_tier: tier, display_name: `${tier} player`, spectating: false }] };
    return HttpResponse.json(mockTable);
  }),
  http.post('http://localhost:8000/tables/:id/start', () => {
    mockTable = { ...mockTable, status: 'in_progress' };
    return HttpResponse.json({ table: mockTable, revision: 0 });
  }),
];

export const worker = setupWorker(...defaultHandlers, ...mockHandlers);

class MockWebSocket extends FakeWebSocket {
  private sentSnapshot = false;
  constructor(url: string) {
    super(url);
    queueMicrotask(() => {
      this.open();
      this.receive({ ...baseSnapshot, payload: { ...baseSnapshot.payload, public: { ...baseSnapshot.payload.public, current_seat: 1 } } });
      this.sentSnapshot = true;
    });
  }
  override send(data: string) {
    super.send(data);
    if (this.sentSnapshot) {
      const command = JSON.parse(data) as { idempotency_key: string };
      queueMicrotask(() => this.receive({ type: 'ack', revision: 1, idempotency_key: command.idempotency_key, payload: { ...baseSnapshot.payload, public: { ...baseSnapshot.payload.public, current_seat: 2 } }, deadline: null }));
    }
  }
}

export function installMockWebSocket() {
  window.WebSocket = MockWebSocket as unknown as typeof WebSocket;
}
