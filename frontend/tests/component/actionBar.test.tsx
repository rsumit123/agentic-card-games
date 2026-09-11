import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar } from '../../src/features/table/ActionBar';
import type { LegalAction } from '../../src/domain/game';

const legal: LegalAction[] = [{ type: 'fold' }, { type: 'call', amount: 5 }, { type: 'raise', min_amount: 20, max_amount: 1000 }, { type: 'all_in', amount: 1000 }];

describe('ActionBar', () => {
  it('renders exactly the legal actions with amounts', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" pot={40} bigBlind={10} />);
    expect(screen.getByRole('button', { name: 'Fold' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Call 5' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Raise' })).toBeEnabled();
  });

  it('shows the bet sizer without asking, and raises the amount on it', async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={legal} canAct onAct={onAct} status="your-turn" pot={40} bigBlind={10} />);
    // No intermediate "open the sizer" step: the sizes are already there.
    expect(screen.getByRole('group', { name: 'Bet size shortcuts' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Pot 40/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', amount: 40 });
  });

  it('starts at the minimum raise and uses it when nothing is chosen', async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={legal} canAct onAct={onAct} status="your-turn" pot={40} bigBlind={10} />);
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', amount: 20 });
  });

  it('asks before a slider-max raise, because that is an all-in', async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={legal} canAct onAct={onAct} status="your-turn" pot={40} bigBlind={10} />);
    await userEvent.click(screen.getByRole('button', { name: /All-in 1,000/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(onAct).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /yes, all in/i }));
    expect(onAct).toHaveBeenCalledWith({ type: 'raise', amount: 1000 });
  });

  it('disables everything while submitting and shows the status text', () => {
    render(<ActionBar legal={legal} canAct={false} onAct={() => {}} status="submitting" />);
    expect(screen.getByRole('button', { name: 'Fold' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
  });

  it('hides Fold when checking is free, so a free hand cannot be thrown away by accident', () => {
    const free: LegalAction[] = [{ type: 'fold' }, { type: 'check' }, { type: 'bet', min_amount: 20, max_amount: 1000 }];
    render(<ActionBar legal={free} canAct onAct={() => {}} status="your-turn" pot={40} bigBlind={10} />);
    expect(screen.queryByRole('button', { name: 'Fold' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
  });

  it('does not offer All-in when calling already puts the last chip in', () => {
    const shove: LegalAction[] = [{ type: 'fold' }, { type: 'call', amount: 700 }, { type: 'all_in', amount: 700 }];
    render(<ActionBar legal={shove} canAct onAct={() => {}} status="your-turn" />);
    expect(screen.getByRole('button', { name: 'Call 700' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /All-in/ })).toBeNull();
  });

  it('hides the sizer when it is not your turn', () => {
    render(<ActionBar legal={[]} canAct={false} onAct={() => {}} status="waiting" waitingFor="Gemini 3.7 Flash" />);
    expect(screen.queryByRole('group', { name: 'Bet size shortcuts' })).toBeNull();
    expect(screen.getByText(/Waiting for Gemini 3.7 Flash/)).toBeInTheDocument();
  });

  it('shows what just happened while waiting', () => {
    render(<ActionBar legal={[]} canAct={false} onAct={() => {}} status="waiting" lastAction="You bet 15" />);
    expect(screen.getByText('You bet 15')).toBeInTheDocument();
  });

  it('shows a rejection message', () => {
    render(<ActionBar legal={legal} canAct onAct={() => {}} status="your-turn" error="amount exceeds stack" />);
    expect(screen.getByRole('alert')).toHaveTextContent('amount exceeds stack');
  });
});
