import { config } from '../config';
import { useSession } from '../store/session';

export type ApiCode = 'unauthenticated' | 'forbidden' | 'conflict' | 'expired' | 'invalid' | 'rate_limited' | 'network' | 'server';
export class ApiError extends Error {
  constructor(public status: number, public code: ApiCode, message: string) { super(message); }
}
const codeFor = (status: number): ApiCode =>
  status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 409 ? 'conflict' : status === 410 ? 'expired'
  : status === 422 ? 'invalid' : status === 429 ? 'rate_limited' : 'server';
const detailText = (detail: unknown): string =>
  typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((entry) => (entry as { msg?: string }).msg ?? 'invalid').join('; ') : 'Request failed';

export async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = useSession.getState().csrfToken ?? '';
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method, headers, credentials: 'include',
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the table server.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) useSession.getState().setAnonymous();
    throw new ApiError(response.status, codeFor(response.status), detailText((data as { detail?: unknown }).detail));
  }
  return (await response.json()) as T;
}
