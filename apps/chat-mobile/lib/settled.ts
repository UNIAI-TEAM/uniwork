// Waiting for a promise to finish without taking its outcome. Not a way to
// hide a failure: the outcome is handled where the promise was made (a
// serialized write returns its own result to the caller; a query reports its
// own error). For a failure nobody else sees, use data/report.ts › bestEffort.
const done = (): void => undefined;

/** Resolves once `promise` has finished, fulfilled or rejected. */
export function settled(promise: Promise<unknown>): Promise<void> {
  return promise.then(done, done);
}
