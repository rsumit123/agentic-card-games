import { describe, it, expect } from 'vitest';
import { config } from '../../src/config';

describe('config', () => {
  it('exposes API and WS base URLs without trailing slashes', () => {
    expect(config.apiBaseUrl).toBe('http://localhost:8000');
    expect(config.wsBaseUrl).toBe('ws://localhost:8000');
  });
});
