import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { z } from "zod";
import { DESKTOP_IDENTITY_MANIFEST } from "../../shared/identity";
import type { DesktopUpdateConfig } from "./config";

export type UpdateRefusalCode = "tls_failure" | "invalid_signature" | "wrong_publisher" | "wrong_app_id" | "wrong_channel" | "hash_mismatch" | "down_level_engine" | "auto_update_disabled" | "invalid_manifest" | "download_failed";

export class UpdateVerificationError extends Error {
  constructor(readonly code: UpdateRefusalCode, message: string) {
    super(message);
    this.name = "UpdateVerificationError";
  }
}

const releaseSchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive().max(512 * 1024 * 1024),
  signature: z.string(),
  publisher: z.string().min(1),
  appId: z.string().min(1),
  channel: z.enum(["stable", "beta", "dev"]),
  engineVersion: z.string().min(1),
  contractVersion: z.string().min(1),
  protocolVersion: z.number().int().positive(),
  draftFormat: z.union([z.literal(1), z.literal(2)]),
}).strict();

export type UpdateRelease = z.infer<typeof releaseSchema>;

/** Installed main-process policy, NEVER populated from a feed or renderer.
 * Git revisions are opaque, not semver: release engineering supplies their
 * reviewed order. Unknown revisions fail closed; no lexical hash comparison.
 * G7 has supplied no production key, so the packaged host leaves this absent. */
export interface UpdateTrust {
  readonly publisher: string;
  readonly publicKeyPem: string;
  readonly engineVersions: readonly string[];
}

/** Fixed-order, versioned payload binds metadata and artifact digest together. */
export function updateSigningPayload(release: Omit<UpdateRelease, "signature">): Buffer {
  return Buffer.from(JSON.stringify([
    `${DESKTOP_IDENTITY_MANIFEST.channelProfiles.stable.executable}-update/1`, release.url, release.sha256, release.size,
    release.publisher, release.appId, release.channel, release.engineVersion,
    release.contractVersion, release.protocolVersion, release.draftFormat,
  ]));
}

export function assertUpdateURL(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.hash) return url;
  } catch { /* All URL failures use the same typed transport refusal. */ }
  throw new UpdateVerificationError("tls_failure", "updates require a credential-free HTTPS URL");
}

/** Checks the signed descriptor before the client requests installer bytes. */
export function verifyRelease(config: DesktopUpdateConfig, raw: unknown, trust?: UpdateTrust): UpdateRelease {
  if (!config.enabled) throw new UpdateVerificationError("auto_update_disabled", "automatic updates are disabled for this build");
  const feed = assertUpdateURL(config.feed ?? "");
  const parsed = releaseSchema.safeParse(raw);
  if (!parsed.success) throw new UpdateVerificationError("invalid_manifest", "update descriptor is malformed");
  const release = parsed.data;
  if (assertUpdateURL(release.url).origin !== feed.origin) throw new UpdateVerificationError("tls_failure", "artifact origin does not match the configured feed");
  if (config.channel !== DESKTOP_IDENTITY_MANIFEST.build.channel || release.channel !== config.channel) throw new UpdateVerificationError("wrong_channel", "update channel does not match this build");
  if (release.appId !== DESKTOP_IDENTITY_MANIFEST.appId) throw new UpdateVerificationError("wrong_app_id", "update app id does not match this build");
  if (!trust || !config.publisher || trust.publisher !== config.publisher || release.publisher !== trust.publisher) throw new UpdateVerificationError("wrong_publisher", "no matching trusted publisher is installed");
  const current = trust.engineVersions.indexOf(DESKTOP_IDENTITY_MANIFEST.engine.version);
  const candidate = trust.engineVersions.indexOf(release.engineVersion);
  if (current < 0 || candidate < current || new Set(trust.engineVersions).size !== trust.engineVersions.length || release.contractVersion !== DESKTOP_IDENTITY_MANIFEST.engine.contractVersion || release.protocolVersion !== DESKTOP_IDENTITY_MANIFEST.engine.protocolVersion) {
    throw new UpdateVerificationError("down_level_engine", "update engine or contract is unsupported or older than this build");
  }
  try {
    const key = createPublicKey(trust.publicKeyPem);
    const signature = Buffer.from(release.signature, "base64");
    if (key.asymmetricKeyType !== "ed25519" || signature.length !== 64 || signature.toString("base64") !== release.signature || !verifySignature(null, updateSigningPayload(release), key, signature)) throw new Error("invalid signature");
  } catch { throw new UpdateVerificationError("invalid_signature", "update signature verification failed"); }
  return release;
}

export function verifyUpdate(config: DesktopUpdateConfig, raw: unknown, bytes: Uint8Array, trust?: UpdateTrust): UpdateRelease {
  const release = verifyRelease(config, raw, trust);
  if (bytes.byteLength !== release.size || createHash("sha256").update(bytes).digest("hex") !== release.sha256) throw new UpdateVerificationError("hash_mismatch", "downloaded installer does not match the signed digest");
  return release;
}
