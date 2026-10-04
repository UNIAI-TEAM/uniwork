import type { XlsxToolbarCommands } from "../toolbar/types";

/** Exact TypeError the pinned `@univerjs/core` 0.25.1 command service raises
 *  when a synchronous execution meets a promise-returning handler. Kept as a
 *  defensive net for a synchronous port; the async port resolves instead. */
const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

/** Runs one numfmt command through the toolbar port.
 *
 *  The pinned increase/decrease-decimal commands are `async` handlers, so the
 *  port (which now routes through the async command service) may hand back a
 *  promise. Callers that only need "did we dispatch" may ignore it; any
 *  failure the port raises synchronously still surfaces. */
export function runNumberFormatCommand(
  commands: XlsxToolbarCommands | undefined,
  id: string,
  params?: unknown,
): boolean | Promise<boolean> {
  if (!commands) return false;
  try {
    return commands.execute(id, params);
  } catch (error) {
    if (error instanceof TypeError && error.message === ASYNC_HANDLER_ERROR) return false;
    throw error;
  }
}
