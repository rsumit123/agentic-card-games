import type { Action } from '../domain/game';
import type { Command, ServerEvent } from '../domain/protocol';
import { config } from '../config';
import { buildCommand, clearPending, loadPending, savePending } from './idempotency';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized' | 'forbidden' | 'handshake_failed' | 'lost';
interface Options {
  WebSocketImpl?: typeof WebSocket; baseUrl?: string; onEvent: (event: ServerEvent) => void; onStatus: (status: SocketStatus) => void;
  onPendingDropped?: () => void; random?: () => number;
}
const MAX_HANDSHAKE_FAILURES = 3;
/** Retrying forever behind a "Reconnecting…" pill is indistinguishable from a
 *  table that will never come back. After this many tries we say so and offer
 *  the player the retry instead. */
const MAX_RECONNECTS = 6;

export class TableSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private everOpened = false;
  private handshakeFailures = 0;

  constructor(private tableId: number, private opts: Options) {}

  connect() { this.stopped = false; this.attempt = 0; this.handshakeFailures = 0; this.open(); }
  retry() { this.attempt = 0; this.handshakeFailures = 0; this.stopped = false; this.open(); }
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.opts.onStatus('closed');
  }
  resync() { this.ws?.close(); }

  send(action: Action, revision: number, seatId: number) {
    const command = buildCommand(action, revision, seatId);
    savePending(this.tableId, command);
    this.raw(command);
  }

  private raw(command: Command) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(command));
  }

  /** A reaction is cosmetic: no revision, no deadline, nothing to replay. */
  react(emoji: string) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'reaction', emoji }));
  }

  private open() {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const base = this.opts.baseUrl ?? config.wsBaseUrl;
    this.opts.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new Impl(`${base}/ws/tables/${this.tableId}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.everOpened = true;
      this.handshakeFailures = 0;
      this.opts.onStatus('open');
    };
    ws.onmessage = (event) => this.handle(JSON.parse(event.data as string) as ServerEvent);
    ws.onclose = (event) => {
      if (this.stopped) return;
      if (event.code === 4401) { this.opts.onStatus('unauthorized'); return; }
      if (event.code === 4403) { this.opts.onStatus('forbidden'); return; }
      if (!this.everOpened && ++this.handshakeFailures >= MAX_HANDSHAKE_FAILURES) {
        this.opts.onStatus('handshake_failed');
        return;
      }
      if (this.attempt >= MAX_RECONNECTS) { this.opts.onStatus('lost'); return; }
      this.opts.onStatus('reconnecting');
      this.schedule();
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
