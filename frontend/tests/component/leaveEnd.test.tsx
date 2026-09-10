import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LeaveEndControls } from '../../src/features/table/LeaveEndControls';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('LeaveEndControls', () => {
  it('host sees End session, disabled during a hand, enabled between hands, and confirms before ending', async () => {
    useSession.setState({ csrfToken: 'tok' });
    let ended = false;
    server.use(http.post('http://localhost:8000/tables/7/end', () => { ended = true; return HttpResponse.json({ id: 7, status: 'ended' }); }));
    const { rerender } = render(<LeaveEndControls tableId={7} isHost handInProgress onLeft={() => {}} />);
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled();
    rerender(<LeaveEndControls tableId={7} isHost handInProgress={false} onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(screen.getByText('The session ends for everyone.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    expect(ended).toBe(true);
  });
  it('guest sees Leave table and is sent to the lobby after leaving', async () => {
    useSession.setState({ csrfToken: 'tok' });
    server.use(http.post('http://localhost:8000/tables/7/leave', () => HttpResponse.json({ id: 7, status: 'in_progress' })));
    const onLeft = vi.fn();
    render(<LeaveEndControls tableId={7} isHost={false} handInProgress={false} onLeft={onLeft} />);
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    expect(onLeft).toHaveBeenCalled();
  });
  it('shows the 409 message from the server', async () => {
    useSession.setState({ csrfToken: 'tok' });
    server.use(http.post('http://localhost:8000/tables/7/end', () => HttpResponse.json({ detail: 'session can only end between hands' }, { status: 409 })));
    render(<LeaveEndControls tableId={7} isHost handInProgress={false} onLeft={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'End session' }));
    await userEvent.click(screen.getByRole('button', { name: 'End for everyone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('between hands');
  });
});
