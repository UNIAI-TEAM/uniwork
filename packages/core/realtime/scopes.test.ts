import { describe, expect, it } from 'vitest';
import { WS_SCOPE_CHAT } from './scopes';

describe('WS scopes', () => {
  it('exports chat scope constant', () => {
    expect(WS_SCOPE_CHAT).toBe('chat');
  });
});
