import { config } from '../config';
import { request } from './http';
import type { User } from '../store/session';

export const loginUrl = () => `${config.apiBaseUrl}/auth/login`;
export const me = () => request<{ user: User; csrf_token: string }>('/auth/me');
export const logout = () => request<{ status: string }>('/auth/logout', { method: 'POST' });
