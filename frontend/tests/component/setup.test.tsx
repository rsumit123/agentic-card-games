import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SetupPage } from '../../src/features/setup/SetupPage';
import { useSession } from '../../src/store/session';
import type { TableView } from '../../src/domain/table';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => { server.resetHandlers(); sessionStorage.clear(); }); afterAll(() => server.close());
const base: TableView = { id: 9, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'lobby', join_expires_at: null,
  final_rankings: [], seats: [{ seat_number: 1, user_id: 1, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: 'Ana', spectating: false }, { seat_number: 2, user_id: null, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: null, spectating: true }] };
const mount = () => render(<MemoryRouter initialEntries={['/tables/9']}><Routes><Route path="/tables/:id" element={<SetupPage view={base} onStarted={() => {}} refresh={() => {}} />} /></Routes></MemoryRouter>);

describe('setup', () => {
  it('lets the host add an AI seat and disables Start until full', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    sessionStorage.setItem('room:9', 'KLMN-2345');
    let tier: unknown;
    server.use(http.post('http://localhost:8000/tables/9/seats/2/ai', async ({ request }) => { tier = (await request.json() as { tier: string }).tier;
      return HttpResponse.json({ ...base, seats: [base.seats[0], { ...base.seats[1], actor_type: 'ai', ai_tier: 'Medium' }] }); }));
    mount();
    expect(screen.getByText('KLMN-2345')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start game/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /add player/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /medium/i }));
    expect(tier).toBe('Medium');
  });
  it('hides host controls from guests', () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 2, google_subject: 'y', email: '', display_name: 'Bo' } });
    mount();
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add player/i })).toBeNull();
    expect(screen.getByText(/ask the host for the code/i)).toBeInTheDocument();
  });
});
