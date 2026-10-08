import { createHash } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { DeploymentProfile } from "../../shared/deployment";
import { createOsCredentialStore, type CredentialStore, type CredentialStoreFileSystem, type SafeStorageAdapter } from "../auth/credentials";

type Channel = "stable" | "beta" | "dev";

/** `<deploymentId>@<sha256(origin)[:12]>`. The origin is part of the key so a
 * profile that reuses a real deployment id with another origin starts with an
 * empty store and can never send a stored refresh token there. Sessions kept
 * under the old `<deploymentId>` directory are not migrated: they are simply
 * not read again, and the user signs in once. */
export function credentialNamespace(profile: Pick<DeploymentProfile, "deploymentId" | "apiOrigin">): string {
  const origin = new URL(profile.apiOrigin).origin;
  return `${profile.deploymentId}@${createHash("sha256").update(origin, "utf8").digest("hex").slice(0, 12)}`;
}

/** OS credential store seam owned by the desktop host: Electron bootstrap
 * builds the store for the resolved profile through this entry only. */
export function createSecureCredentialStore(options: Readonly<{
  userDataDirectory: string;
  channel: Channel;
  profile: Pick<DeploymentProfile, "deploymentId" | "apiOrigin">;
  safeStorage: SafeStorageAdapter;
  fileSystem?: CredentialStoreFileSystem;
}>): CredentialStore {
  return createOsCredentialStore({ userDataDirectory: options.userDataDirectory, channel: options.channel, namespace: credentialNamespace(options.profile), safeStorage: options.safeStorage, fileSystem: options.fileSystem });
}

type WipeFileSystem = Readonly<{
  readdirSync(path: string): string[];
  rmSync(path: string, options: { recursive: true; force: true }): void;
}>;

/** Removes every credential directory of one deployment on one channel: each
 * origin-scoped `<deploymentId>@…` root and the pre-origin `<deploymentId>`
 * one. Used by the explicit "reset connection"; other deployments stay. */
export function wipeDeploymentCredentials(options: Readonly<{ userDataDirectory: string; channel: Channel; deploymentId: string; fileSystem?: WipeFileSystem }>): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.deploymentId)) return;
  const fs = options.fileSystem ?? { readdirSync, rmSync };
  const channelRoot = join(options.userDataDirectory, "credentials", options.channel);
  let names: string[];
  try { names = fs.readdirSync(channelRoot); }
  catch { return; }
  for (const name of names) {
    if (name === options.deploymentId || name.startsWith(`${options.deploymentId}@`)) fs.rmSync(join(channelRoot, name), { recursive: true, force: true });
  }
}
