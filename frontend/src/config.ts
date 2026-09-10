const strip = (value: string | undefined, fallback: string) => (value ?? fallback).replace(/\/+$/, '');

export const config = {
  apiBaseUrl: strip(import.meta.env.VITE_API_BASE_URL, 'http://localhost:8000'),
  wsBaseUrl: strip(import.meta.env.VITE_WS_BASE_URL, 'ws://localhost:8000'),
  mockApi: import.meta.env.VITE_MOCK_API === '1',
};
