import { request } from './http';
import type { AiTierInfo } from '../domain/table';

export const listAiTiers = () => request<{ tiers: AiTierInfo[] }>('/ai/tiers');
