import type { ButtonHTMLAttributes, MouseEvent } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean };

/**
 * A disabled button leaves the tab order, so focus falls to the body the
 * instant you press one and the action bar disables itself. `aria-disabled`
 * keeps it focusable and announced while still refusing the click.
 */
export function Button({ variant = 'quiet', busy, children, disabled, className, onClick, ...rest }: Props) {
  const off = disabled || busy;
  return <button
    className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
    aria-disabled={off || undefined}
    aria-busy={busy || undefined}
    onClick={off ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
    {...rest}
  >{children}</button>;
}
