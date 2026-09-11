import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LobbyPage } from '../../src/features/lobby/LobbyPage';
import { CreateTablePage } from '../../src/features/lobby/CreateTablePage';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const view = { id: 9, room_code: 'KLMN-2345', host_user_id: 1, seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20, status: 'lobby', join_expires_at: null, seats: [], final_rankings: [] };
const mount = () => render(<MemoryRouter><Routes><Route path="/" element={<LobbyPage />} /><Route path="/create" element={<CreateTablePage />} /><Route path="/tables/:id" element={<p>table 9</p>} /></Routes></MemoryRouter>);

describe('lobby', () => {
  it('creates a table from its own screen, stores the code, and opens the table', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    let body: unknown;
    server.use(http.post('http://localhost:8000/tables', async ({ request }) => { body = await request.json(); return HttpResponse.json(view); }));
    mount();
    // Creating a table is a step of its own, not a form unfolding under the
    // home screen, and three options do not need a menu to hide them in.
    await userEvent.click(screen.getByRole('link', { name: /create a table/i }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Seats' })).getByRole('button', { name: '3' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Starting chips' })).getByRole('button', { name: '5,000' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Blinds' })).getByRole('button', { name: '10 / 20' }));
    await userEvent.click(screen.getByRole('button', { name: /^create table$/i }));
    expect(await screen.findByText('table 9')).toBeInTheDocument();
    expect(body).toEqual({ seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20 });
    expect(sessionStorage.getItem('room:9')).toBe('KLMN-2345');
  });

  it('can back out of creating a table', async () => {
    mount();
    await userEvent.click(screen.getByRole('link', { name: /create a table/i }));
    expect(screen.getByRole('heading', { name: /create private table/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /play now/i })).toBeInTheDocument();
  });

  it('leads with the two ways to play, and explains the game to a first-time player', async () => {
    mount();
    expect(screen.getByRole('button', { name: /play now/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a table/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /how it works/i }));
    expect(screen.getByRole('heading', { name: /what beats what/i })).toBeInTheDocument();
    expect(screen.getByText('Straight flush')).toBeInTheDocument();
  });

  it('uppercases the join code and shows the server message on 410', async () => {
    server.use(http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ detail: 'table has expired' }, { status: 410 })));
    mount();
    await userEvent.click(screen.getByRole('button', { name: /play now/i }));
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'abcd-1234');
    expect(input).toHaveValue('ABCD-1234');
    await userEvent.click(screen.getByRole('button', { name: /join with code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });
});
