import { describe, expect, it } from 'vitest';
import { WS_SCOPE_CHAT, WS_SCOPE_MEETING } from './scopes';

describe('WS scopes', () => {
  it('exports chat scope constant', () => {
    expect(WS_SCOPE_CHAT).toBe('chat');
  });

  it('exports the meeting scope the hub authorizes', () => {
    expect(WS_SCOPE_MEETING).toBe('meeting');
  });
});
