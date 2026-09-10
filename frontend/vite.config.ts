import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['tests/setup.ts'], globals: false, include: ['tests/**/*.{test,spec}.{js,ts,jsx,tsx}'], exclude: ['tests/e2e/**'] },
});
