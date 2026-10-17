/**
 * The closed IPC surface (ADR 0026): every `ipcMain.handle` listener is built
 * with `guard`, which refuses a frame outside the app origin and runs the
 * payload through one of the hand-written validators below before the handler
 * sees it. Strings are capped at 64 KiB.
 */

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

/** True when the sending frame is still alive and its document has the app origin. */
export function isTrustedSender(event: IpcSender, appOrigin: string): boolean {
  if (!event.senderFrame) return false;
  try {
    return new URL(event.senderFrame.url).origin === appOrigin;
  } catch {
    return false;
  }
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
