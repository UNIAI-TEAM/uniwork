/* global process */
// Electron main entry of the headless-keyring probe (UNI-1376, g7-qa spike).
// keyring-probe.mjs launches it with the fork's own Electron binary; it is never
// run with plain node (it imports `electron`). It prints one JSON line on stdout
// and quits: the result of keyring-probe-core.mjs `runProbe` against the fork's
// real credential store, bundled by the driver into PROBE_BUNDLE_URL.
//
// Env: PROBE_BUNDLE_URL (file:// URL of the bundled credentials.ts),
// GENOFFICE_USER_DATA (the scratch userData dir the store writes its file in).
import { app, safeStorage } from "electron";
import { runProbe } from "./keyring-probe-core.mjs";

const done = (result, code) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(code);
};

app.whenReady().then(async () => {
  try {
    // getSelectedStorageBackend() throws before ready on Linux, so everything runs after it
    const { createCredentialStore } = await import(process.env.PROBE_BUNDLE_URL);
    const result = runProbe({
      createCredentialStore,
      safeStorage,
      userDataDir: process.env.GENOFFICE_USER_DATA,
    });
    done({ ...result, electron: process.versions.electron }, 0);
  } catch (error) {
    // a bundle that does not load is the harness's fault, said without the message (paths)
    done({ probe: "keyring", status: "error", roundTrip: "fail", errorCode: error?.code ?? "probe_error" }, 1);
  }
});
