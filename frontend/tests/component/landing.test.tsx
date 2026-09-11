import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import App from '../../src/App';
import { useSession } from '../../src/store/session';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); useSession.getState().setAnonymous(); useSession.setState({ status: 'loading' }); });
afterAll(() => server.close());
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('auth gate', () => {
  it('shows the sign-in landing when /auth/me is 401', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ detail: 'Authentication required' }, { status: 401 })));
    at('/');
    const link = await screen.findByRole('link', { name: /sign in with google/i });
    expect(link).toHaveAttribute('href', 'http://localhost:8000/auth/login');
  });
  it('shows the lobby when signed in', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ user: { id: 1, google_subject: 'x', email: 'a@b', display_name: 'Ana' }, csrf_token: 'tok' })));
    at('/');
    expect(await screen.findByRole('button', { name: /create a table/i })).toBeInTheDocument();
  });
  it('shows an error state when the server is unreachable', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.error()));
    at('/');
    expect(await screen.findByText(/could not reach the table server/i)).toBeInTheDocument();
  });
});
