import { describe, expect, it } from "vitest";
import { LOGIN_ATTEMPT_TTL_MS, LoginAttemptStore } from "./attempt-store";

const config = { clientId: "com.uniwork.office", deploymentId: "production-eu", redirectUri: "uniwork-office://auth/callback" };

describe("login attempt store", () => {
  it("keeps independent opaque state and attempt ids and expires at ten minutes", () => {
    const store = new LoginAttemptStore({ randomBytes: (size) => new Uint8Array(size).fill(2) });
    const attempt = store.begin({ ...config, now: 1_000 });
    expect(attempt.state).not.toBe(attempt.attemptId);
    expect(attempt.expiresAt).toBe(1_000 + LOGIN_ATTEMPT_TTL_MS);
    expect(store.get(attempt.attemptId, attempt.expiresAt - 1)).toBe(attempt);
    expect(store.get(attempt.attemptId, attempt.expiresAt)).toBeUndefined();
    expect(store.size()).toBe(0);
  });
  it("makes an attempt single-use and a new start invalidates the previous one", () => {
    let fill = 3;
    const store = new LoginAttemptStore({ randomBytes: (size) => new Uint8Array(size).fill(fill++) });
    const first = store.begin({ ...config, now: 1 });
    const second = store.begin({ ...config, now: 2 });
    expect(store.get(first.attemptId, 2)).toBeUndefined();
    expect(store.consume(second.attemptId, 2)).toBe(second);
    expect(store.consume(second.attemptId, 2)).toBeUndefined();
    expect(store.cancel()).toBe(false);
  });
});
