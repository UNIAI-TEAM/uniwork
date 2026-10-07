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

/** Runs the steps of one rule edit all or nothing (review dvcf F1): none is
 *  accepted at once, one runs alone, several run as one undo step that takes
 *  back what ran when a later step is refused. A port without that batch
 *  refuses several steps rather than leave a rule half-edited. */
export async function runRuleCommandsAtomically(
  commands: XlsxToolbarCommands,
  steps: readonly { id: string; params: unknown }[],
): Promise<boolean> {
  if (steps.length === 0) return true;
  if (steps.length === 1) return runRuleCommand(commands, steps[0]!.id, steps[0]!.params);
  if (!commands.executeAsOneStep) return false;
  try {
    return (await commands.executeAsOneStep(steps, { atomic: true })) === true;
  } catch {
    return false;
  }
}
