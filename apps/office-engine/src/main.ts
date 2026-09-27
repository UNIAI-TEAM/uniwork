// Process entry for the engine service. This is the one file that reads the
// environment (the deployer's injection point); everything below it takes the
// parsed config. SIGTERM/SIGINT drain: stop accepting, settle live jobs as
// crashed(shutdown), kill every worker tree, remove temp dirs, then exit.

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngineService, loadConfig } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const bundled = !import.meta.url.endsWith(".ts");

const config = loadConfig(process.env, {
  tempRoot: join(tmpdir(), "uniwork-office-engine"),
  workerEntry: bundled ? join(here, "worker.mjs") : fileURLToPath(new URL("./worker/entry.ts", import.meta.url)),
});
const service = createEngineService(config);
const port = await service.listen();
process.stdout.write(JSON.stringify({ msg: "office engine listening", port, ready: service.ready() }) + "\n");

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(JSON.stringify({ msg: "office engine stopping", signal }) + "\n");
  await service.close();
  process.exit(0);
}
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
