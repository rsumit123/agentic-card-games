import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { SetupPage } from '../../src/features/setup/SetupPage';
import { useSession } from '../../src/store/session';
import type { TableView } from '../../src/domain/table';

const tierHandler = http.get('http://localhost:8000/ai/tiers', () => HttpResponse.json({
  tiers: [
    { tier: 'Easy', model: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
    { tier: 'Medium', model: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
    { tier: 'Hard', model: 'openai/gpt-4o', label: 'GPT-4o' },
  ],
}));
const server = setupServer(tierHandler);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => { server.resetHandlers(); sessionStorage.clear(); }); afterAll(() => server.close());
const base: TableView = { id: 9, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'lobby', join_expires_at: null,
  final_rankings: [], seats: [{ seat_number: 1, user_id: 1, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: 'Ana', spectating: false, model: null }, { seat_number: 2, user_id: null, actor_type: 'human', ai_tier: null, chip_count: 1000, display_name: null, spectating: true, model: null }] };
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
    expect(screen.getByRole('button', { name: /start game/i })).toHaveAttribute('aria-disabled', 'true');
    // An open seat is something to do: invite a person, or sit a model there.
    await userEvent.click(screen.getByRole('button', { name: /add ai/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /medium/i }));
    expect(tier).toBe('Medium');
  });

  it('lets the host change or send away a house player', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    let removed = false;
    server.use(http.delete('http://localhost:8000/tables/9/seats/2/ai', () => { removed = true; return HttpResponse.json(base); }));
    const seated: TableView = { ...base, seats: [base.seats[0], { ...base.seats[1], actor_type: 'ai', ai_tier: 'Medium', display_name: 'GPT-4o mini' }] };
    render(<MemoryRouter><SetupPage view={seated} onStarted={() => {}} refresh={() => {}} /></MemoryRouter>);
    expect(screen.getByText('GPT-4o mini')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /change or remove/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /remove player/i }));
    expect(removed).toBe(true);
  });
  it('hides host controls from guests', () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 2, google_subject: 'y', email: '', display_name: 'Bo' } });
    mount();
    expect(screen.queryByRole('button', { name: /start game/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add ai/i })).toBeNull();
    expect(screen.getByText(/ask the host for the code/i)).toBeInTheDocument();
  });
});
