import { vi } from "vitest";
import type { ShellConfig } from "../runtime-config";
import { CredentialStoreError, type CredentialStore, type StoredCredential } from "./credentials";
import { ShellSession } from "./session";
import { TransportError, type DesktopSession, type Transport, type TransportErrorCode } from "./transport";

/** in-memory credential store with the production contract, nothing on disk */
export function createMemoryCredentialStore(initial: StoredCredential | null = null): CredentialStore {
  let current = initial;
  return {
    load: () => current,
    save: (credential) => {
      current = { ...credential };
    },
    clear: () => {
      current = null;
    },
    canStore: () => true,
  };
}

/** a credential store whose OS keyring is locked: load() and save() report `keystore_locked` */
export function createLockedCredentialStore(): CredentialStore {
  const locked = () => {
    throw new CredentialStoreError("keystore_locked");
  };
  return { load: locked, save: locked, clear: vi.fn(), canStore: () => true };
}

export const shellConfig: ShellConfig = {
  env: "prod",
  appUrl: "https://app.example",
  apiUrl: "https://uniwork.example",
  deploymentId: "default",
  clientId: "uniwork-chat-desktop",
  scheme: "uniworkchat",
  redirectUri: "uniworkchat://auth/callback",
};

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

function fakeTransport() {
  return {
    start: vi.fn<Transport["start"]>(async () => ({
      authorizationUrl: "https://uniwork.example/auth/desktop/authorize?attempt=1",
    })),
    exchange: vi.fn<Transport["exchange"]>(async () => fakeSession()),
    refresh: vi.fn<Transport["refresh"]>(async () => fakeSession()),
    logout: vi.fn<Transport["logout"]>(async () => undefined),
  } satisfies Transport;
}

export const stored = (overrides: Partial<StoredCredential> = {}): StoredCredential => ({
  deploymentId: "default",
  apiOrigin: "https://uniwork.example",
  clientId: "uniwork-chat-desktop",
  accountId: "acc_1",
  deviceSessionId: "dev_1",
  sessionId: "sess_1",
  refreshToken: "rt_stored",
  refreshExpiresAt: Date.now() + 86_400_000,
  ...overrides,
});

export function setup(options: { credentials?: CredentialStore } = {}) {
  const transport = fakeTransport();
  const credentials = options.credentials ?? createMemoryCredentialStore();
  const openBrowser = vi.fn<(url: string) => Promise<void>>(async () => undefined);
  const shell = new ShellSession({ config: shellConfig, transport, credentials, openBrowser });
  const tokens: (string | null)[] = [];
  const unsubscribe = shell.onChange((t) => tokens.push(t));
  return { shell, transport, credentials, openBrowser, tokens, unsubscribe };
}
export type Harness = ReturnType<typeof setup>;

/** the `state` the last start() call sent, i.e. the one the open browser tab will echo */
export const lastState = (ctx: Harness): string =>
  (ctx.transport.start.mock.lastCall as Parameters<Transport["start"]>)[0].state;
export const callback = (state: string, code = "c1") =>
  `uniworkchat://auth/callback?code=${code}&state=${encodeURIComponent(state)}`;

/** signs in through start -> callback -> exchange with the real attempt state */
export async function signIn(ctx: Harness) {
  await ctx.shell.login();
  await ctx.shell.completeCallback(callback(lastState(ctx)));
}
