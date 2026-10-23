// `vitest` is a devDependency and this is not a *.test.ts file, so the mock
// factory is handed in by each test (a type-only import is not a dependency).
import type { vi as Vi } from "vitest";
import type { MobileSessionConfig, SessionStorage, StoredSession } from "./session";
import { MobileSession } from "./session";
import { TransportError, type DesktopSession, type Transport, type TransportErrorCode } from "./transport";

const sessionConfig: MobileSessionConfig = {
  clientId: "uniwork-chat-mobile",
  deploymentId: "default",
  redirectUri: "uniworkchat://auth/callback",
  platform: "ios",
  deviceLabel: "UniChat (iOS)",
};

/** in-memory SessionStorage: the epoch check of the real one; the previous-token check is secure-storage.test.ts's business */
type VI = typeof Vi;

export function createMemoryStorage(
  vi: VI,
  initial: StoredSession | null = null,
  epochChanged: (at: number) => boolean = () => false,
) {
  let current = initial;
  const storage = {
    load: vi.fn<SessionStorage["load"]>(async () => current),
    clear: vi.fn<SessionStorage["clear"]>(async () => {
      current = null;
    }),
    commit: vi.fn<SessionStorage["commit"]>(async (next, expected) => {
      if (epochChanged(expected.epoch)) return false;
      current = { ...next };
      return true;
    }),
    /** test-only peek */
    current: () => current,
  };
  return storage;
}
export type MemoryStorage = ReturnType<typeof createMemoryStorage>;

let tokenSeq = 0;
export const resetFakeSessions = () => {
  tokenSeq = 0;
};

/** the server's answer to exchange/refresh: `at_n` / `rt_n` number the tokens handed out */
export const fakeSession = (overrides: Partial<DesktopSession> = {}): DesktopSession => {
  tokenSeq += 1;
  return {
    accountId: "acc_1",
    deviceSessionId: "dev_1",
    sessionId: "sess_1",
    deploymentId: "default",
    accessToken: `at_${tokenSeq}`,
    refreshToken: `rt_${tokenSeq}`,
    expiresIn: 900,
    refreshExpiresIn: 30 * 24 * 3600,
    ...overrides,
  };
};

/** server codes arrive in the `{error:{code}}` envelope; network-ish ones never do */
const LOCAL_CODES: ReadonlySet<TransportErrorCode> = new Set(["network", "timeout", "malformed_response"]);
export const fail = (code: TransportErrorCode, retryAfterMs?: number) => () =>
  Promise.reject(new TransportError(code, undefined, !LOCAL_CODES.has(code), retryAfterMs));

export function fakeTransport(vi: VI) {
  return {
    start: vi.fn<Transport["start"]>(async () => ({
      authorizationUrl: "https://uniwork.example/auth/desktop/authorize?attempt=1",
    })),
    exchange: vi.fn<Transport["exchange"]>(async () => fakeSession()),
    refresh: vi.fn<Transport["refresh"]>(async () => fakeSession()),
    logout: vi.fn<Transport["logout"]>(async () => undefined),
  } satisfies Transport;
}

export const stored = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  access_token: "at_stored",
  refresh_token: "rt_stored",
  device_session_id: "dev_1",
  deployment_id: "default",
  expires_at: Date.now() + 900_000,
  refresh_expires_at: Date.now() + 86_400_000,
  ...overrides,
});

export const callback = (state: string, code = "c1") =>
  `uniworkchat://auth/callback?code=${code}&state=${encodeURIComponent(state)}`;

export function setup(vi: VI, options: { storage?: MemoryStorage; epochChanged?: (at: number) => boolean } = {}) {
  const transport = fakeTransport(vi);
  const storage = options.storage ?? createMemoryStorage(vi, null, options.epochChanged);
  // the fake browser echoes the attempt's state back, like the consent page does
  const openBrowser = vi.fn<(url: string, redirectUri: string) => Promise<string | null>>(async () =>
    callback(lastState({ transport })),
  );
  const session = new MobileSession({ config: sessionConfig, transport, storage, openBrowser });
  const tokens: (string | null)[] = [];
  const unsubscribe = session.onChange((t) => tokens.push(t));
  return { session, transport, storage, openBrowser, tokens, unsubscribe };
}

/** the `state` the last start() call sent, i.e. the one the open browser tab will echo */
export const lastState = (ctx: { transport: ReturnType<typeof fakeTransport> }): string =>
  (ctx.transport.start.mock.lastCall as Parameters<Transport["start"]>)[0].state;
