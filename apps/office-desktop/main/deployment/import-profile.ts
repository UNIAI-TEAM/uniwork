import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { domainToUnicode } from "node:url";
import { DeploymentProfileResolutionError, USER_DATA_PROFILE_FILE, parseDeploymentProfile, type DeploymentProfile } from "../../shared/deployment";

/** A deployment profile is four short fields; anything bigger is not one. */
export const MAX_PROFILE_BYTES = 4096;

export type ProfileImportResult = Readonly<{ status: "imported" | "cancelled" | "already_configured" | "invalid" | "channel_mismatch" | "unavailable" }>;
export type ConnectionResetResult = Readonly<{ status: "reset" | "cancelled" | "not_imported" | "unavailable" }>;

/** What the confirmation names: the host as the user reads it (IDN decoded)
 * and as it is spelled on the wire, so a punycode look-alike shows both. */
export type ProfileConfirmation = Readonly<{ host: string; rawHost: string; deploymentId: string }>;

type Channel = DeploymentProfile["channel"];

type ImportFileSystem = Readonly<{
  existsSync(path: string): boolean;
  statSync(path: string): { size: number; isFile(): boolean };
  readFileSync(path: string): Uint8Array;
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  openSync(path: string, flags: string): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  chmodSync(path: string, mode: number): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, options: { force: true }): void;
}>;

const nodeFileSystem: ImportFileSystem = { existsSync, statSync, readFileSync, mkdirSync, writeFileSync, openSync, fsyncSync, closeSync, chmodSync, renameSync, rmSync };

export type ProfileImportOptions = Readonly<{
  userDataDirectory: string;
  buildChannel: Channel;
  /** The installer-owned profile (Windows resources). It outranks userData, so
   * while it exists an import could never take effect. */
  installedProfilePath?: string;
  /** True when a profile resolves right now (any source). */
  isConfigured(): boolean;
  /** Main's own native picker; the renderer never names a path. */
  pickFile(): Promise<string | undefined>;
  /** Native confirmation whose default button is Cancel. */
  confirmImport(confirmation: ProfileConfirmation): Promise<boolean>;
  confirmReset(confirmation: ProfileConfirmation | undefined): Promise<boolean>;
  wipeCredentials(deploymentId: string): void;
  /** Called after a settled import or reset; the host restarts so the
   * resolver, the credential store and the auth channels start over. */
  relaunch(): void;
  fileSystem?: ImportFileSystem;
}>;

export function profileConfirmation(profile: Pick<DeploymentProfile, "apiOrigin" | "deploymentId">): ProfileConfirmation {
  const url = new URL(profile.apiOrigin);
  const decoded = domainToUnicode(url.hostname) || url.hostname;
  return Object.freeze({ host: url.port ? `${decoded}:${url.port}` : decoded, rawHost: url.host, deploymentId: profile.deploymentId });
}

/**
 * The "choose configuration file" flow of a host without a deployment profile
 * (macOS has no install hook to place one; a Windows Setup run from inside a
 * zip viewer misses its sidecar). Main owns every step: the picker, a 4 KiB
 * cap, the shared strict validator, a refusal while any profile resolves, a
 * confirmation that names the origin host, then an atomic 0600 write to
 * userData and a relaunch. Replacing a working profile needs the explicit
 * reset, which also wipes that deployment's stored sessions.
 */
export function createProfileImport(options: ProfileImportOptions): Readonly<{ importProfile(): Promise<ProfileImportResult>; resetConnection(): Promise<ConnectionResetResult>; isImported(): boolean }> {
  const fs = options.fileSystem ?? nodeFileSystem;
  const target = join(options.userDataDirectory, USER_DATA_PROFILE_FILE);
  const installerOwned = () => Boolean(options.installedProfilePath && fs.existsSync(options.installedProfilePath));

  async function importProfile(): Promise<ProfileImportResult> {
    if (options.isConfigured() || installerOwned()) return { status: "already_configured" };
    const picked = await options.pickFile();
    if (!picked) return { status: "cancelled" };
    let profile: DeploymentProfile;
    try {
      profile = parseDeploymentProfile(readSmallJson(fs, picked), options.buildChannel);
    } catch (error) {
      return { status: error instanceof DeploymentProfileResolutionError && error.code === "channel_mismatch" ? "channel_mismatch" : "invalid" };
    }
    if (!(await options.confirmImport(profileConfirmation(profile)))) return { status: "cancelled" };
    // The state may have changed while the dialogs were open.
    if (options.isConfigured() || installerOwned()) return { status: "already_configured" };
    try { writeAtomically(fs, target, `${JSON.stringify(profile, null, 2)}\n`); }
    catch { return { status: "unavailable" }; }
    options.relaunch();
    return { status: "imported" };
  }

  async function resetConnection(): Promise<ConnectionResetResult> {
    if (installerOwned() || !fs.existsSync(target)) return { status: "not_imported" };
    const current = readImportedIdentity(fs, target);
    if (!(await options.confirmReset(current))) return { status: "cancelled" };
    try {
      if (current) options.wipeCredentials(current.deploymentId);
      fs.rmSync(target, { force: true });
    } catch { return { status: "unavailable" }; }
    options.relaunch();
    return { status: "reset" };
  }

  return Object.freeze({
    importProfile,
    resetConnection,
    /** True while the profile in use is one the user imported. */
    isImported: () => !installerOwned() && fs.existsSync(target),
  });
}

export type ProfileImportFlow = ReturnType<typeof createProfileImport>;

function readSmallJson(fs: ImportFileSystem, file: string): unknown {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error("not a profile file");
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > MAX_PROFILE_BYTES) throw new Error("not a profile file");
  // TextDecoder drops a leading BOM (a profile saved by a Windows editor).
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** The reset names whatever the imported file still says, even when it no
 * longer validates (a profile of another channel, a damaged file): the
 * deployment id decides which sessions are wiped. */
function readImportedIdentity(fs: ImportFileSystem, file: string): ProfileConfirmation | undefined {
  try {
    const raw = readSmallJson(fs, file) as { deploymentId?: unknown; apiOrigin?: unknown };
    if (typeof raw.deploymentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw.deploymentId) || typeof raw.apiOrigin !== "string") return undefined;
    return profileConfirmation({ deploymentId: raw.deploymentId, apiOrigin: raw.apiOrigin });
  } catch { return undefined; }
}

function writeAtomically(fs: ImportFileSystem, target: string, contents: string): void {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  let fd: number | undefined;
  try {
    fs.mkdirSync(join(target, ".."), { recursive: true });
    fs.writeFileSync(temp, contents, { mode: 0o600, flag: "wx" });
    fs.chmodSync(temp, 0o600);
    fd = fs.openSync(temp, "r+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, target);
    fs.chmodSync(target, 0o600);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}
