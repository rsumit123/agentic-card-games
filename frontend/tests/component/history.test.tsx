import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { HistoryPage } from '../../src/features/history/HistoryPage';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const at = () => render(<MemoryRouter><HistoryPage /></MemoryRouter>);

describe('your record', () => {
  it('shows the headline rates and the split by opponent', async () => {
    server.use(http.get('http://localhost:8000/me/history', () => HttpResponse.json({
      hands: { played: 40, won: 18, win_rate: 45, net_chips: -320, showdowns: 12 },
      sessions: { played: 4, won: 1, win_rate: 25 },
      opponents: [
        { opponent: 'Easy', hands: 20, won: 12, win_rate: 60, net_chips: 640 },
        { opponent: 'Hard', hands: 20, won: 6, win_rate: 30, net_chips: -960 },
      ],
      recent: [{ table_id: 3, won: false, net_chips: -150, opponents: ['Hard'], showdown: true, at: null }],
    })));
    at();

    expect(await screen.findByText('45%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/18 of 40 hands, −320 chips/)).toBeInTheDocument();
    expect(screen.getByText('Easy house player')).toBeInTheDocument();
    expect(screen.getByText('Hard house player')).toBeInTheDocument();
    expect(screen.getByText('+640')).toBeInTheDocument();
    expect(screen.getByText(/against Hard house player, to a showdown/)).toBeInTheDocument();
  });

  it('invites a new player to go and play', async () => {
    server.use(http.get('http://localhost:8000/me/history', () => HttpResponse.json({
      hands: { played: 0, won: 0, win_rate: 0, net_chips: 0, showdowns: 0 },
      sessions: { played: 0, won: 0, win_rate: 0 },
      opponents: [],
      recent: [],
    })));
    at();

    expect(await screen.findByText(/No finished hands yet/)).toBeInTheDocument();
    expect(screen.queryByText('Against each opponent')).toBeNull();
  });
});
