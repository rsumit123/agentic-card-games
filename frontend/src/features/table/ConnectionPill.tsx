import type { SocketStatus } from '../../ws/TableSocket';

const TEXT: Record<SocketStatus, string> = { connecting: 'Connecting…', open: 'Connected', reconnecting: 'Reconnecting…', closed: 'Offline', unauthorized: 'Signed out', forbidden: 'Not seated at this table', handshake_failed: 'Could not join the table' };
export function ConnectionPill({ status }: { status: SocketStatus }) {
  return <span className={`pill pill-${status}`} role="status">{TEXT[status]}</span>;
}
