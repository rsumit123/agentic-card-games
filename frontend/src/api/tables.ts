import { request } from './http';
import type { AiTier, TableView } from '../domain/table';

export interface CreateTableInput { seat_count: 2 | 3 | 4; starting_chips: 1000 | 5000 | 10000; small_blind: 5 | 10 | 25; big_blind: number }
export const createTable = (input: CreateTableInput) => request<TableView>('/tables', { method: 'POST', body: input });
export const joinTable = (code: string) => request<TableView>('/tables/join', { method: 'POST', body: { code } });
export const getTable = (id: number) => request<TableView>(`/tables/${id}`);
export const startTable = (id: number) => request<{ table: TableView; revision: number }>(`/tables/${id}/start`, { method: 'POST' });
export const fillAiSeat = (id: number, seat: number, tier: AiTier) =>
  request<TableView>(`/tables/${id}/seats/${seat}/ai`, { method: 'POST', body: { tier } });
export const leaveTable = (id: number) => request<TableView>(`/tables/${id}/leave`, { method: 'POST' });
export const endTable = (id: number) => request<TableView>(`/tables/${id}/end`, { method: 'POST' });
export const sitOut = (id: number) => request<TableView>(`/tables/${id}/sit-out`, { method: 'POST' });
export const sitIn = (id: number) => request<TableView>(`/tables/${id}/sit-in`, { method: 'POST' });
export const nextHand = (id: number) => request<TableView>(`/tables/${id}/next-hand`, { method: 'POST' });
