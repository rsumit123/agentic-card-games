import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from '../../src/features/table/ActionBar';
import type { LegalAction } from '../../src/domain/game';

const legal: LegalAction[] = [{ type: 'fold' }, { type: 'call', amount: 5 }, { type: 'raise', min_amount: 20, max_amount: 1000 }, { type: 'all_in', amount: 1000 }];

describe('ActionBar', () => {
  it('renders exactly the legal actions with amounts', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" />);
    expect(screen.getByRole('button', { name: 'Fold' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Call 5' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Raise' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'All-in 1,000' })).toBeEnabled();
  });
  it('clamps the raise amount to the bounds and submits a raise-to total', async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={legal} canAct onAct={onAct} status="your-turn" />);
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    const input = screen.getByLabelText('Raise to');
    await userEvent.clear(input); await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: /confirm raise/i }));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', amount: 20 });
  });
  it('disables everything while submitting and shows the status text', () => {
    render(<ActionBar legal={legal} canAct={false} onAct={() => {}} status="submitting" />);
    expect(screen.getByRole('button', { name: 'Fold' })).toBeDisabled();
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
  });
  it('shows a rejection message', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" error="amount exceeds stack" />);
    expect(screen.getByRole('alert')).toHaveTextContent('amount exceeds stack');
  });
});
