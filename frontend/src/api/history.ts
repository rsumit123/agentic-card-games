import { request } from './http';
import type { PlayerHistory } from '../domain/history';

export const getHistory = () => request<PlayerHistory>('/me/history');
