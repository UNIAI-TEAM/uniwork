// Lifecycle of the `office_offline_library` organization override the FL rows
// switch on (G7-03b, UNI-1382; review r1 R1-9). The override is scoped to the
// run's tenant, and the tenant outlives every row, so the override is a shared
// resource with an owner: only the run that enabled it lifts it, a lift is read
// back (a DELETE that answered 204 is not proof), and a lift that cannot be
// proven stops the remaining rows as BLOCKED instead of leaving them on a
// tenant that still carries the capability. An FL run also clears a leftover
// override (an earlier process killed before its lift) before it enables its
// own, so a stale `enabled` can never pass for this run's switch.
//
// The calls are injected (`set`, `clear`, `read`) so the lifecycle is tested
// without a server; app-cases.mjs passes the app-tenant.mjs functions.

/**
 * @param {{ set: (enabled: boolean) => Promise<unknown>, clear: () => Promise<unknown>, read: () => Promise<{override?: object|null, error?: string}> }} calls
 */
export function createOfflineFlagGuard({ set, clear, read }) {
  const state = { failure: null };

  /** The reason the capability could not be lifted, or null while the tenant is clean. */
  const failure = () => state.failure;

  /**
   * One run's view of the override. `enable()` is the only call that gives the
   * run ownership, and it takes it BEFORE the request is sent: a request that
   * threw may still have created the override, so the run must lift it.
   */
  function forRun() {
    const run = { owned: false };
    return {
      /** the capability for this run: clear a leftover first, then switch it on */
      async enable() {
        run.owned = true;
        const leftover = await read();
        if (leftover.error) throw new Error(`the leftover office_offline_library override could not be read: ${leftover.error}`);
        if (leftover.override) await clear();
        await set(true);
      },
      owned: () => run.owned,
      /**
       * Lifts what this run enabled and proves it. Returns null when nothing was
       * enabled or the override is gone; otherwise the reason it is not, which is
       * also recorded so every later row is BLOCKED with it.
       */
      async lift() {
        if (!run.owned) return null;
        let reason = null;
        try {
          await clear();
        } catch (error) {
          reason = `the DELETE of the office_offline_library override failed: ${error?.message ?? error}`;
        }
        // read back even after a failed DELETE: it may have taken effect
        const after = await read().catch((error) => ({ error: error?.message ?? String(error) }));
        if (after.error) reason = `${reason ? `${reason}; ` : ""}the override could not be read back: ${after.error}`;
        else if (after.override) reason = `${reason ? `${reason}; ` : ""}the office_offline_library override is still present after the lift (enabled=${after.override.enabled})`;
        else reason = null;
        run.owned = reason !== null;
        if (reason) state.failure = reason;
        return reason;
      },
    };
  }

  return { failure, forRun };
}

/** The BLOCKED reason a row gets once a lift failed: names the cause so a human can clean the tenant. */
export const liftBlocker = (reason) =>
  `not run: the office_offline_library override of this tenant could not be lifted by an earlier row (${reason}); the tenant still carries the capability, so no later row is trustworthy`;
