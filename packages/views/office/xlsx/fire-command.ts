import type { XlsxToolbarCommands } from "./toolbar/types";

/** Exact TypeError the pinned `@univerjs/core` command service raises when a
 *  synchronous execution meets a promise-returning handler. */
const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

/** Row/column insert and delete: a refusal here changes nothing on the grid,
 *  so the person is told instead of seeing a silent no-op. */
const STRUCTURAL_COMMAND = /^sheet\.command\.(insert-(row|col|multi-rows|multi-cols)|remove-(row|col))/;

interface RefusalListener {
  /** The command port of one document; undefined listens to every document. */
  readonly scope: XlsxToolbarCommands | undefined;
  readonly notify: (commandId: string) => void;
}

const refusalListeners = new Set<RefusalListener>();

/** Subscribes to refused structural commands (the frame notice); returns the
 *  unsubscribe. With `scope` (the document's command port) only refusals
 *  dispatched through that port reach the listener, so one open document's
 *  refusal never raises a notice in another (UNI-957). */
export function subscribeCommandRefusals(listener: (commandId: string) => void, scope?: XlsxToolbarCommands): () => void {
  const entry: RefusalListener = { scope, notify: listener };
  refusalListeners.add(entry);
  return () => { refusalListeners.delete(entry); };
}

/** Fires one toolbar command-port dispatch and marks the returned promise
 *  explicitly ignored, so a deliberate fire-and-forget is never a floating
 *  promise. The command is dispatched exactly once: a synchronous refusal (or
 *  the pinned async-handler TypeError) is absorbed, and an async rejection or a
 *  resolved `false` - a refused command, never silence - is reported through
 *  `onError` (a console warning by default; a refused structural command also
 *  reaches the frame notice). A refused command must never unmount the
 *  toolbar, so nothing is rethrown. */
export function fireCommand(
  commands: XlsxToolbarCommands | undefined,
  id: string,
  params?: unknown,
  onError?: (message: string) => void,
): void {
  if (!commands) return;
  const warn = onError ?? ((message: string) => console.warn(`[xlsx-command] ${message}`));
  const report = (message: string) => {
    warn(message);
    if (STRUCTURAL_COMMAND.test(id)) refusalListeners.forEach((listener) => { if (listener.scope === undefined || listener.scope === commands) listener.notify(id); });
  };
  try {
    // Preserve the caller's original call arity: a no-params command must be
    // dispatched as execute(id), not execute(id, undefined), so the
    // observed command-port call shape is unchanged for every caller.
    const dispatched = params === undefined ? commands.execute(id) : commands.execute(id, params);
    void Promise.resolve(dispatched)
      .then((executed) => { if (!executed) report(`${id} was refused`); })
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)));
  } catch (error) {
    if (error instanceof TypeError && error.message === ASYNC_HANDLER_ERROR) return;
    report(error instanceof Error ? error.message : String(error));
  }
}