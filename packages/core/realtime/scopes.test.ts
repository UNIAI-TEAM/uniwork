import { describe, expect, it, vi } from 'vitest';
import { LOOKUP_RETRY_DELAYS_MS, lookupRetryDelayMs, WS_SCOPE_CHAT, WS_SCOPE_MEETING } from './scopes';

describe('WS scopes', () => {
  it('exports chat scope constant', () => {
    expect(WS_SCOPE_CHAT).toBe('chat');
  });

  it('exports the meeting scope the hub authorizes', () => {
    expect(WS_SCOPE_MEETING).toBe('meeting');
  });

  it('lookupRetryDelayMs uses full jitter within the step base', () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0);
    expect(lookupRetryDelayMs(0)).toBe(0);
    random.mockReturnValueOnce(1);
    expect(lookupRetryDelayMs(0)).toBe(LOOKUP_RETRY_DELAYS_MS[0]);
    random.mockRestore();
  });
});
