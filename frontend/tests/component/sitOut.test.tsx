import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeaveEndControls } from '../../src/features/table/LeaveEndControls';
import * as api from '../../src/api/tables';

describe('sitting out', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('offers to sit out while playing', async () => {
    const spy = vi.spyOn(api, 'sitOut').mockResolvedValue({} as never);
    render(<LeaveEndControls tableId={7} isHost={false} handInProgress onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sit out next hand' }));
    expect(spy).toHaveBeenCalledWith(7);
  });

  it('offers to sit back in once you are out', async () => {
    const spy = vi.spyOn(api, 'sitIn').mockResolvedValue({} as never);
    render(<LeaveEndControls tableId={7} isHost={false} handInProgress sittingOut onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sit back in' }));
    expect(spy).toHaveBeenCalledWith(7);
  });
});
