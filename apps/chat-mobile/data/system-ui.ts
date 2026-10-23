// System screens UniChat opens on purpose and waits on: the Google / UniWork
// sign-in in a Custom Tab or ASWebAuthenticationSession, the photo and file
// pickers, a runtime permission prompt. Android puts the app in the
// "background" while one is up, so anything that acts on a trip to the
// background (data/updates-controller.ts reloading for a critical update) asks
// here first: a reload then would drop the pending sign-in or the picked file.
let open = 0;

/** Whether a system screen the app is waiting on is up. */
export function systemUiOpen(): boolean {
  return open > 0;
}

/** Runs work (which opens a system screen and waits for its answer) with the screen marked open. */
export async function whileSystemUiOpen<T>(work: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await work();
  } finally {
    open -= 1;
  }
}
