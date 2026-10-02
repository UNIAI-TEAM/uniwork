import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

/** The per-device id that scopes every local-mode draft. It is main-owned and
 * never crosses IPC; renderer requests carry opaque handles only. */
export interface LocalDeviceFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options: { flag: "wx"; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const nodeFileSystem: LocalDeviceFileSystem = {
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data, options) => fs.writeFile(path, data, options),
  rename: (from, to) => fs.rename(from, to),
  mkdir: async (path, options) => { await fs.mkdir(path, options); },
  rm: async (path, options) => { await fs.rm(path, options); },
};

export class LocalDeviceError extends Error {
  readonly code: "corrupt" | "unavailable";
  constructor(code: "corrupt" | "unavailable", message = "local device state is unavailable") {
    super(message);
    this.name = "LocalDeviceError";
    this.code = code;
  }
}

const DEVICE_PATTERN = /^[0-9a-f]{32}$/;

export function deviceScopeAccountId(deviceId: string): string {
  if (!DEVICE_PATTERN.test(deviceId)) throw new LocalDeviceError("corrupt", "local device id is invalid");
  return `local:${deviceId}`;
}

/** Reads the durable per-device id, creating it once. A corrupt record is a
 * typed failure: silently replacing it would orphan every local draft key. */
export async function loadOrCreateDeviceId(options: {
  userDataDirectory: string;
  fileSystem?: LocalDeviceFileSystem;
  randomBytes?: (size: number) => Uint8Array;
}): Promise<string> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const random = options.randomBytes ?? randomBytes;
  const path = join(options.userDataDirectory, "local", "device.json");
  let raw: Uint8Array | undefined;
  try {
    raw = await fileSystem.readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LocalDeviceError("unavailable", "local device state could not be read");
    raw = undefined;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as { version?: unknown; deviceId?: unknown };
      if (parsed.version !== 1 || typeof parsed.deviceId !== "string" || !DEVICE_PATTERN.test(parsed.deviceId)) throw new Error("invalid device record");
      return parsed.deviceId;
    } catch {
      throw new LocalDeviceError("corrupt", "local device record is corrupt");
    }
  }
  const deviceId = Buffer.from(random(16)).toString("hex");
  if (!DEVICE_PATTERN.test(deviceId)) throw new LocalDeviceError("unavailable", "local device id could not be generated");
  await fileSystem.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fileSystem.writeFile(temporary, new TextEncoder().encode(JSON.stringify({ version: 1, deviceId })), { flag: "wx", mode: 0o600 });
    await fileSystem.rename(temporary, path);
  } catch (error) {
    await fileSystem.rm(temporary, { force: true }).catch(() => undefined);
    try {
      const existing = await fileSystem.readFile(path);
      const parsed = JSON.parse(new TextDecoder().decode(existing)) as { version?: unknown; deviceId?: unknown };
      if (parsed.version === 1 && typeof parsed.deviceId === "string" && DEVICE_PATTERN.test(parsed.deviceId)) return parsed.deviceId;
    } catch { /* fall through to the typed failure */ }
    if (error instanceof LocalDeviceError) throw error;
    throw new LocalDeviceError("unavailable", "local device state could not be written");
  }
  return deviceId;
}
