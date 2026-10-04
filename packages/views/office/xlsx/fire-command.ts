import type { XlsxToolbarCommands } from "./toolbar/types";

/** Exact TypeError the pinned `@univerjs/core` command service raises when a
 *  synchronous execution meets a promise-returning handler. */
const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

/** Fires one toolbar command-port dispatch and marks the returned promise
 *  explicitly ignored, so a deliberate fire-and-forget is never a floating
 *  promise. The command is dispatched exactly once: a synchronous refusal (or
 *  the pinned async-handler TypeError) is absorbed, and an async rejection or a
 *  resolved `false` - a refused command, never silence - is reported through
 *  `onError` (a console warning by default). A refused command must never
 *  unmount the toolbar, so nothing is rethrown. */
export function fireCommand(
  commands: XlsxToolbarCommands | undefined,
  id: string,
  params?: unknown,
  onError?: (message: string) => void,
): void {
  if (!commands) return;
  const report = onError ?? ((message: string) => console.warn(`[xlsx-command] ${message}`));
  try {
    void Promise.resolve(commands.execute(id, params))
      .then((executed) => { if (!executed) report(`${id} was refused`); })
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)));
  } catch (error) {
    if (error instanceof TypeError && error.message === ASYNC_HANDLER_ERROR) return;
    report(error instanceof Error ? error.message : String(error));
  }
}