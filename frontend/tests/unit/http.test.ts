import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { request, ApiError } from '../../src/api/http';
import { useSession } from '../../src/store/session';

const server = setupServer(
  http.get('http://localhost:8000/auth/me', () =>
    HttpResponse.json({ user: { id: 1, google_subject: 'x', email: 'a@b', display_name: 'Ana' }, csrf_token: 'tok' })),
  http.post('http://localhost:8000/tables', ({ request }) => {
    if (request.headers.get('x-csrf-token') !== 'tok') return HttpResponse.json({ detail: 'CSRF token missing' }, { status: 403 });
    return HttpResponse.json({ id: 7, room_code: 'ABCD-1234' });
  }),
  http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ detail: 'table is full' }, { status: 409 })),
);
beforeAll(() => server.listen()); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

describe('request', () => {
  it('sends credentials and the CSRF token on POST', async () => {
    useSession.setState({ csrfToken: 'tok' });
    const out = await request<{ id: number }>('/tables', { method: 'POST', body: { seat_count: 2 } });
    expect(out.id).toBe(7);
  });
  it('normalises FastAPI detail into ApiError', async () => {
    await expect(request('/tables/join', { method: 'POST', body: { code: 'x' } })).rejects.toMatchObject(
      new ApiError(409, 'conflict', 'table is full'));
  });
  it('flips the session to anonymous on 401', async () => {
    server.use(http.get('http://localhost:8000/auth/me', () => HttpResponse.json({ detail: 'Authentication required' }, { status: 401 })));
    useSession.setState({ status: 'authenticated' });
    await expect(request('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(useSession.getState().status).toBe('anonymous');
  });
});
