// Side-effect module: shortens the FL drivers' waits for the node:test fakes
// (app-case-drivers-offline.mjs reads these once at import, so a test file that
// needs a fast "never arrives" imports this FIRST). A cloud run never loads it.
process.env.UNIWORK_FL_STATE_TIMEOUT_MS = "40";
process.env.UNIWORK_FL_DOWNLOAD_TIMEOUT_MS = "40";
process.env.UNIWORK_FL_POLL_MS = "2";
process.env.UNIWORK_FL_PANE_TIMEOUT_MS = "300";
