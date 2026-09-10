import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { LobbyPage } from '../../src/features/lobby/LobbyPage';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const view = { id: 9, room_code: 'KLMN-2345', host_user_id: 1, seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20, status: 'lobby', join_expires_at: null, seats: [], final_rankings: [] };
const mount = () => render(<MemoryRouter><Routes><Route path="/" element={<LobbyPage />} /><Route path="/tables/:id" element={<p>table 9</p>} /></Routes></MemoryRouter>);

describe('lobby', () => {
  it('creates a table with the chosen settings, stores the code, and navigates', async () => {
    useSession.setState({ status: 'authenticated', csrfToken: 'tok', user: { id: 1, google_subject: 'x', email: '', display_name: 'Ana' } });
    let body: unknown;
    server.use(http.post('http://localhost:8000/tables', async ({ request }) => { body = await request.json(); return HttpResponse.json(view); }));
    mount();
    await userEvent.selectOptions(screen.getByLabelText(/seats/i), '3');
    await userEvent.selectOptions(screen.getByLabelText(/starting chips/i), '5000');
    await userEvent.selectOptions(screen.getByLabelText(/blinds/i), '10');
    await userEvent.click(screen.getByRole('button', { name: /create table/i }));
    expect(await screen.findByText('table 9')).toBeInTheDocument();
    expect(body).toEqual({ seat_count: 3, starting_chips: 5000, small_blind: 10, big_blind: 20 });
    expect(sessionStorage.getItem('room:9')).toBe('KLMN-2345');
  });
  it('uppercases the join code and shows the server message on 410', async () => {
    server.use(http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ detail: 'table has expired' }, { status: 410 })));
    mount();
    const input = screen.getByLabelText(/room code/i);
    await userEvent.type(input, 'abcd-1234');
    expect(input).toHaveValue('ABCD-1234');
    await userEvent.click(screen.getByRole('button', { name: /join with code/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });
});
