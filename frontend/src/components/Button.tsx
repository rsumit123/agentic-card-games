import type { ButtonHTMLAttributes, MouseEvent } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'danger'; busy?: boolean };

/**
 * A disabled button leaves the tab order, so focus falls to the body the
 * instant you press one and the action bar disables itself. `aria-disabled`
 * keeps it focusable and announced while still refusing the click.
 */
export function Button({ variant = 'quiet', busy, children, disabled, className, onClick, type, ...rest }: Props) {
  const off = disabled || busy;
  // aria-disabled does not block implicit form submission the way the real
  // attribute does, so a submit button keeps it and accepts the lost focus.
  const hard = off && type === 'submit';
  return <button
    type={type}
    disabled={hard || undefined}
    className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
    aria-disabled={off || undefined}
    aria-busy={busy || undefined}
    onClick={off ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick}
    {...rest}
  >{children}</button>;
}
