import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/** Per-device mode preference: whether the next launch with no session opens
 * the local home instead of the sign-in card. Never read by an account path. */
export interface LocalModeFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options: { flag: "wx"; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const nodeFileSystem: LocalModeFileSystem = {
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  rename: (from, to) => fs.rename(from, to),
  mkdir: async (path, options) => { await fs.mkdir(path, options); },
  rm: async (path, options) => { await fs.rm(path, options); },
};

export interface LocalModeStore {
  get(): boolean;
  set(local: boolean): Promise<boolean>;
}

/** Reads the preference at boot; a corrupt or unreadable record falls back to
 * the sign-in card, which is the safe default for a fresh device. */
export async function createLocalModeStore(options: {
  userDataDirectory: string;
  fileSystem?: LocalModeFileSystem;
}): Promise<LocalModeStore> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const path = join(options.userDataDirectory, "local", "mode.json");
  let local = false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await fileSystem.readFile(path))) as { version?: unknown; localMode?: unknown };
    local = parsed.version === 1 && parsed.localMode === true;
  } catch { local = false; }
  let tail: Promise<void> = Promise.resolve();
  return Object.freeze({
    get: () => local,
    set(next: boolean): Promise<boolean> {
      local = next === true;
      const write = async () => {
        await fileSystem.mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
        try {
          await fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify({ version: 1, localMode: local })), { flag: "wx", mode: 0o600 });
          await fileSystem.rename(temporary, path);
        } catch {
          await fileSystem.rm(temporary, { force: true }).catch(() => undefined);
        }
      };
      tail = tail.then(write, write);
      return tail.then(() => local);
    },
  });
}
