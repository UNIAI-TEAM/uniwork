import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { DESKTOP_IDENTITY_MANIFEST } from "../../shared/identity";
import type { DesktopUpdateConfig } from "./config";

export type UpdateRefusalCode =
  | "tls_failure"
  | "invalid_signature"
  | "wrong_publisher"
  | "wrong_app_id"
  | "wrong_channel"
  | "hash_mismatch"
  | "down_level_engine"
  | "auto_update_disabled";

export class UpdateVerificationError extends Error {
  readonly code: UpdateRefusalCode;
  constructor(code: UpdateRefusalCode, message: string) {
    super(message);
    this.name = "UpdateVerificationError";
    this.code = code;
  }
}

export interface UpdateArtifact {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly signature: string;
  readonly publicKey: string | Uint8Array;
  readonly publisher: string;
  readonly appId: string;
  readonly channel: "stable" | "beta" | "dev";
  readonly engineVersion: string;
  readonly contractVersion: string;
}

export interface VerifiedUpdate {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly channel: UpdateArtifact["channel"];
  readonly appId: string;
  readonly publisher: string;
}

function refuse(code: UpdateRefusalCode, message: string): never {
  throw new UpdateVerificationError(code, message);
}

function compatibleVersion(candidate: string, installed: string): boolean {
  // Engine versions are provider@revision. The provider and contract family
  // must match; a missing/unknown revision is down-level rather than guessed.
  const candidateProvider = candidate.split("@")[0]?.trim();
  const installedProvider = installed.split("@")[0]?.trim();
  return Boolean(candidateProvider && installedProvider && candidateProvider === installedProvider);
}

/** Verify a feed item before it reaches the native updater. Every refusal has
 * a stable code so UI/logging can distinguish policy from transport failure. */
export function verifyUpdate(config: DesktopUpdateConfig, artifact: UpdateArtifact): VerifiedUpdate {
  if (!config.enabled) refuse("auto_update_disabled", "automatic updates are disabled for this build");
  let url: URL;
  try { url = new URL(artifact.url); } catch { refuse("tls_failure", "update feed URL is invalid"); }
  if (url!.protocol !== "https:") refuse("tls_failure", "update feed must use HTTPS");
  if (config.feed && new URL(config.feed).origin !== url!.origin) refuse("tls_failure", "artifact origin does not match the configured feed");
  if (artifact.channel !== config.channel || artifact.channel !== DESKTOP_IDENTITY_MANIFEST.build.channel) refuse("wrong_channel", "update channel does not match the installed build");
  if (artifact.appId !== DESKTOP_IDENTITY_MANIFEST.appId) refuse("wrong_app_id", "update app id does not match the identity manifest");
  if (!config.publisher || artifact.publisher !== config.publisher) refuse("wrong_publisher", "update publisher is not allowlisted");
  if (!compatibleVersion(artifact.engineVersion, DESKTOP_IDENTITY_MANIFEST.engine.version) || artifact.contractVersion !== DESKTOP_IDENTITY_MANIFEST.engine.contractVersion) refuse("down_level_engine", "update engine or contract is incompatible");
  const digest = createHash("sha256").update(artifact.bytes).digest("hex");
  if (digest.toLowerCase() !== artifact.sha256.toLowerCase()) refuse("hash_mismatch", "update hash does not match the feed metadata");
  let signature: Buffer;
  try { signature = Buffer.from(artifact.signature, "base64"); } catch { refuse("invalid_signature", "update signature is not base64"); }
  try {
    const key = createPublicKey(typeof artifact.publicKey === "string" ? artifact.publicKey : Buffer.from(artifact.publicKey));
    if (!verifySignature(null, Buffer.from(artifact.bytes), key, signature!)) refuse("invalid_signature", "update signature verification failed");
  } catch { refuse("invalid_signature", "update signature verification failed"); }
  return { bytes: artifact.bytes, sha256: digest, channel: artifact.channel, appId: artifact.appId, publisher: artifact.publisher };
}
