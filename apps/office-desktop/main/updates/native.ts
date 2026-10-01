import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { extname, join } from "node:path";
import type { DesktopUpdateClient } from "./client";
import { RestartUpdateError } from "./restart";
import { UpdateVerificationError, type UpdateRelease } from "./verifier";

/** Only the client's verified bytes reach this main-process installer port. */
export function createNativeInstaller(options: {
  directory: string;
  platform: string;
  openPath: (path: string) => Promise<string>;
}) {
  return async (release: UpdateRelease, bytes: Uint8Array): Promise<void> => {
    const suffix = extname(new URL(release.url).pathname).toLowerCase();
    const allowed = options.platform === "win32" ? [".exe"] : options.platform === "darwin" ? [".pkg", ".dmg"] : [];
    if (!allowed.includes(suffix)) throw new UpdateVerificationError("download_failed", "installer format is unsupported on this platform");
    await fs.mkdir(options.directory, { recursive: true });
    const directory = await fs.mkdtemp(join(options.directory, "install-"));
    const file = join(directory, `UniWork-Office-Setup${suffix}`);
    const handle = await fs.open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    const persisted = await fs.readFile(file);
    if (persisted.length !== release.size || createHash("sha256").update(persisted).digest("hex") !== release.sha256) throw new UpdateVerificationError("hash_mismatch", "installer readback failed");
    if (await options.openPath(file)) throw new UpdateVerificationError("download_failed", "installer could not be opened");
  };
}

/** Menu clicks cannot race downloads, confirmation dialogs, or installers. */
export function createNativeUpdateAction(options: {
  client: Pick<DesktopUpdateClient, "checkAndDownload" | "restartToInstall">;
  install: (release: UpdateRelease, bytes: Uint8Array) => Promise<void>;
  report: (code: string) => Promise<void>;
}): () => Promise<void> {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await options.client.checkAndDownload();
      await options.client.restartToInstall(options.install);
    } catch (error) {
      if (error instanceof RestartUpdateError && error.code === "confirmation_required") return;
      await options.report(error instanceof UpdateVerificationError || error instanceof RestartUpdateError ? error.code : "download_failed");
    } finally { busy = false; }
  };
}
