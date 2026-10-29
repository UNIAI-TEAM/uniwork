/**
 * The closed IPC surface (ADR 0026): every `ipcMain.handle` listener is built
 * with `guard`, which refuses a frame outside the app origin and runs the
 * payload through one of the hand-written validators below before the handler
 * sees it. Strings are capped at 64 KiB.
 */
import type { DesktopLoginOptions, LoginProvider } from "../../shared/bridge";

export const MAX_IPC_BYTES = 65536;

/** The slice of IpcMainInvokeEvent the guard reads; a real event satisfies it structurally. */
export interface IpcSender {
  senderFrame: { url: string } | null;
}

export class IpcRejected extends Error {
  readonly name = "IpcRejected";
  constructor(readonly reason: string) {
    // Reason only, never the payload: the message travels back to the renderer.
    super(`ipc rejected: ${reason}`);
  }
}

/** True when `url` parses and its origin is the app's. */
export function hasAppOrigin(url: string, appOrigin: string): boolean {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/** True when the sending frame is still alive and its document has the app origin. */
export function isTrustedSender(event: IpcSender, appOrigin: string): boolean {
  return event.senderFrame !== null && hasAppOrigin(event.senderFrame.url, appOrigin);
}

/** The slice of BrowserWindow a main→renderer push needs; a real window satisfies it structurally. */
export interface AppWindow {
  webContents: { mainFrame: { url: string }; send(channel: string, payload: unknown): void };
}

/** Push to the renderer only while the app document is loaded (not the offline page or a hijacked frame). */
export function sendToApp(win: AppWindow | null, appOrigin: string, channel: string, payload: unknown): void {
  // Dropped silently: a token or link must never reach a foreign document.
  if (!win || !hasAppOrigin(win.webContents.mainFrame.url, appOrigin)) return;
  win.webContents.send(channel, payload);
}

export function expectString(value: unknown, max = MAX_IPC_BYTES): string {
  if (typeof value !== "string") throw new IpcRejected("not_string");
  if (Buffer.byteLength(value, "utf8") > max) throw new IpcRejected("too_large");
  return value;
}

/** An absolute URL string; the scheme allowlist is the handler's job (`external-url.ts`). */
export function expectUrl(value: unknown): string {
  const url = expectString(value);
  try {
    new URL(url);
  } catch {
    throw new IpcRejected("not_url");
  }
  return url;
}

export function expectCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new IpcRejected("not_count");
  return value;
}

export function expectBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new IpcRejected("not_boolean");
  return value;
}

/** Every provider the start route takes, and nothing else (typed against the bridge, so neither side drifts). */
const LOGIN_PROVIDERS: Readonly<Record<LoginProvider, true>> = { google: true, apple: true };

/**
 * `session:login`'s payload: nothing (the UniWork sign-in page), or exactly
 * `{ provider }` naming one of LOGIN_PROVIDERS. An extra key, a null or a
 * provider the server would answer 400 is refused here, never sent.
 */
export function expectLoginOptions(value: unknown): DesktopLoginOptions | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IpcRejected("not_login_options");
  const keys = Object.keys(value);
  const provider: unknown = (value as { provider?: unknown }).provider;
  if (keys.length !== 1 || keys[0] !== "provider" || typeof provider !== "string" || !Object.hasOwn(LOGIN_PROVIDERS, provider)) {
    throw new IpcRejected("not_login_options");
  }
  return { provider: provider as LoginProvider };
}

/**
 * Builds the listener for `ipcMain.handle(channel, guard(appOrigin, validate, handler))`.
 * A refusal rejects the renderer's invoke with `IpcRejected` and never reaches the handler.
 */
export function guard<T, R>(
  appOrigin: string,
  validate: (payload: unknown) => T,
  handler: (payload: T, event: IpcSender) => R | Promise<R>,
): (event: IpcSender, payload?: unknown) => Promise<R> {
  return async (event, payload) => {
    if (!isTrustedSender(event, appOrigin)) throw new IpcRejected("untrusted_sender");
    return handler(validate(payload), event);
  };
}
