import type { XlsxToolbarCommands } from "../toolbar/types";

/** Exact TypeError the pinned `@univerjs/core` command service raises when a
 *  synchronous execution meets a promise-returning handler (see
 *  ../fire-command.ts): the command did run, so it counts as accepted. */
const ASYNC_HANDLER_ERROR = "[CommandService]: Command handler should not return a promise.";

/** Runs one rule command exactly once and reports whether it was accepted.
 *  Resolves false for a refusal (`false`), a rejection or a synchronous throw,
 *  so a dialog can stay open and say so instead of closing on a no-op. */
export async function runRuleCommand(commands: XlsxToolbarCommands, id: string, params: unknown): Promise<boolean> {
  try {
    return (await commands.execute(id, params)) === true;
  } catch (error) {
    return error instanceof TypeError && error.message === ASYNC_HANDLER_ERROR;
  }
}
