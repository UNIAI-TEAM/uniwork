import type { XlsxToolbarCommands } from "../toolbar/types";

/** Exact TypeError the pinned `@univerjs/core` 0.25.1 command service raises
 *  when a synchronous execution meets a promise-returning handler. */
const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

/** Runs one numfmt command through the toolbar port.
 *
 *  The pinned increase/decrease-decimal commands are `async` handlers while
 *  the port executes `syncExecuteCommand`. Univer applies the nested sync
 *  `sheet.mutation.set.numfmt` mutation first (the edit reaches the journal)
 *  and then throws because the outer handler returned a promise; that exact
 *  TypeError is absorbed here so the click neither crashes nor double-applies.
 *  Any other failure still surfaces. */
export function runNumberFormatCommand(
  commands: XlsxToolbarCommands | undefined,
  id: string,
  params?: unknown,
): boolean {
  if (!commands) return false;
  try {
    return commands.execute(id, params);
  } catch (error) {
    if (error instanceof TypeError && error.message === ASYNC_HANDLER_ERROR) return false;
    throw error;
  }
}
