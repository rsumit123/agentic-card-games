export function Chip({ amount, label }: { amount: number; label?: string }) {
  return <span className="chip tabular" aria-label={label ? `${label} ${amount}` : `${amount} chips`}>{label && <b>{label}</b>}<span>{amount.toLocaleString()}</span></span>;
}
