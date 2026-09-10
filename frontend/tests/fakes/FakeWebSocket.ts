export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  static reset() { FakeWebSocket.instances = []; }
  static last() { return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]; }
}
