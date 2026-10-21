// Whether this launch is the first of a fresh install (audit "Security &
// privacy", keychain-survives-reinstall). iOS keeps Keychain items after the
// app is deleted, so without this a reinstall finds the previous install's
// session and signs that account straight back in. The marker lives in the
// device store (MMKV, a file of the app's container), which an uninstall does
// delete: no marker means a new container.
//
// A launch that upgrades a build from before the marker has a device store
// with keys already (the locale sync, the query cache, the queues all write
// there once someone signs in), so it is not mistaken for a new install.
// A store that only lives in memory this launch (no key, no native module)
// cannot tell, so nothing is wiped on its word.
import { openDeviceStore } from "./storage/device-store";

const MARKER_KEY = "install/marker";

export async function firstLaunchOfInstall(now: () => number = Date.now): Promise<boolean> {
  const store = await openDeviceStore();
  if (!store.durable || store.getString(MARKER_KEY) !== undefined) return false;
  const upgraded = store.keys().length > 0;
  store.set(MARKER_KEY, String(now()));
  return !upgraded;
}
