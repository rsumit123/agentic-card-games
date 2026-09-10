import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean };
export function Button({ variant = 'quiet', busy, children, disabled, className, ...rest }: Props) {
  return <button className={`btn btn-${variant}${className ? ` ${className}` : ''}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>{children}</button>;
}
