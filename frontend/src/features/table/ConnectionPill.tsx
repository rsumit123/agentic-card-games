import type { SocketStatus } from '../../ws/TableSocket';

const TEXT: Record<SocketStatus, string> = { connecting: 'Connecting…', open: 'Connected', reconnecting: 'Reconnecting…', closed: 'Offline', unauthorized: 'Signed out', forbidden: 'Not seated at this table', handshake_failed: 'Could not join the table', lost: 'Lost the table' };
export function ConnectionPill({ status }: { status: SocketStatus }) {
  // A healthy connection is the boring case. On a phone it shrinks to a dot so
  // the header has room for the controls; anything else keeps its words.
  return (
    <span className={`pill pill-${status}`} role="status" data-ok={status === 'open' ? 'true' : undefined}>
      <span className="pill-text">{TEXT[status]}</span>
    </span>
  );
}
