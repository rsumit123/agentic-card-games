import { http, HttpResponse } from 'msw';

export const defaultHandlers = [
  http.get('http://localhost:8000/auth/me', () =>
    HttpResponse.json({ user: { id: 1, google_subject: 'x', email: 'a@b', display_name: 'Ana' }, csrf_token: 'tok' })),
  http.post('http://localhost:8000/tables', () => HttpResponse.json({ id: 7, room_code: 'ABCD-1234' })),
  http.post('http://localhost:8000/tables/join', () => HttpResponse.json({ id: 7, room_code: null })),
];
