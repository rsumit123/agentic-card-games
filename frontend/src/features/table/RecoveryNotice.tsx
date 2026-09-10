import { Button } from '../../components/Button';

export function RecoveryNotice({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return <div role="alert" className="recovery"><p>{message}</p>{onDismiss && <Button onClick={onDismiss}>Continue</Button>}</div>;
}
