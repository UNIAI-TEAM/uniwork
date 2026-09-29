import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(app, "dist");
await mkdir(dist, { recursive: true });
await writeFile(join(dist, "unsigned-dev-package.json"), JSON.stringify({ product: "UniWork Office", appId: "com.uniwork.office", executable: "uniwork-office", signed: false, update: "disabled", userData: "uniwork-office-dev", artifact: "dist/main/index.mjs" }, null, 2) + "\n");
process.stdout.write("office-desktop: unsigned dev package metadata written (signing/update disabled)\n");
