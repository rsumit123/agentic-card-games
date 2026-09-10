import { create } from 'zustand';

export interface User { id: number; google_subject: string; email: string; display_name: string }
type Status = 'loading' | 'anonymous' | 'authenticated' | 'error';
interface SessionState {
  status: Status; user: User | null; csrfToken: string | null;
  setAuthenticated: (user: User, csrfToken: string) => void; setAnonymous: () => void; setError: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading', user: null, csrfToken: null,
  setAuthenticated: (user, csrfToken) => set({ status: 'authenticated', user, csrfToken }),
  setAnonymous: () => set({ status: 'anonymous', user: null, csrfToken: null }),
  setError: () => set({ status: 'error' }),
}));
