import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiSeatMenu } from '../../src/features/setup/AiSeatMenu';
import type { AiTierInfo } from '../../src/domain/table';

const tiers: AiTierInfo[] = [
  { tier: 'Easy', model: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { tier: 'Medium', model: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { tier: 'Hard', model: 'openai/gpt-4o', label: 'GPT-4o' },
];

describe('AiSeatMenu', () => {
  it('says an LLM will play the seat and names the model behind each tier', async () => {
    const onPick = vi.fn();
    render(<AiSeatMenu tiers={tiers} busy={false} onPick={onPick} />);

    await userEvent.click(screen.getByRole('button', { name: 'Play with an LLM' }));
    expect(screen.getByRole('menuitem', { name: /Hard\s+GPT-4o/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: /Medium/ }));
    expect(onPick).toHaveBeenCalledWith('Medium');
  });
});
