import { get } from "node:https";
import { DEFAULT_UPDATE_CONFIG, type DesktopUpdateConfig } from "./config";
import { assertUpdateURL, UpdateVerificationError, verifyRelease, verifyUpdate, type UpdateRelease, type UpdateTrust } from "./verifier";
import { restartToUpdate, type RestartUpdateOptions } from "./restart";

/** Node HTTPS retains normal CA and hostname verification. Redirects are
 * refused, so neither feed nor installer can escape the configured origin. */
export function downloadUpdateBytes(value: string, maxBytes: number, certificateAuthority?: string): Promise<Uint8Array> {
  const url = assertUpdateURL(value);
  return new Promise((resolve, reject) => {
    const request = get(url, { rejectUnauthorized: true, minVersion: "TLSv1.2", ...(certificateAuthority ? { ca: certificateAuthority } : {}) }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new UpdateVerificationError("download_failed", "update server refused the request or redirected"));
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > maxBytes) { response.destroy(new UpdateVerificationError("download_failed", "update exceeds its download limit")); return; }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const deadline = setTimeout(() => request.destroy(new UpdateVerificationError("download_failed", "update download timed out")), 60_000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof UpdateVerificationError) { reject(error); return; }
      const tls = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code ?? "");
      reject(new UpdateVerificationError(tls ? "tls_failure" : "download_failed", tls ? "update TLS validation failed" : "update download failed"));
    });
  });
}

export interface DesktopUpdateClientOptions {
  readonly config?: DesktopUpdateConfig;
  readonly trust?: UpdateTrust;
  readonly restart?: RestartUpdateOptions;
  /** Main-only transport injection for a local HTTPS fixture with its own CA. */
  readonly download?: (url: string, limit: number) => Promise<Uint8Array>;
}

/** Owned only by main. Production has no trust key/feed and remains disabled.
 * Downloaded bytes stay private and are rechecked before reaching the installer. */
export class DesktopUpdateClient {
  private readonly config: DesktopUpdateConfig;
  private readonly trust?: UpdateTrust;
  private pending?: { release: UpdateRelease; bytes: Uint8Array };
  private downloading = false;

  constructor(private readonly options: DesktopUpdateClientOptions = {}) {
    this.config = { ...(options.config ?? DEFAULT_UPDATE_CONFIG) };
    this.trust = options.trust ? { ...options.trust, engineVersions: [...options.trust.engineVersions] } : undefined;
  }

  async checkAndDownload(): Promise<UpdateRelease> {
    if (!this.config.enabled) throw new UpdateVerificationError("auto_update_disabled", "unsigned automatic updates are disabled");
    if (!this.trust) throw new UpdateVerificationError("wrong_publisher", "no trusted update publisher is installed");
    if (this.downloading) throw new UpdateVerificationError("download_failed", "an update download is already running");
    this.downloading = true;
    this.pending = undefined;
    try {
      const download = this.options.download ?? downloadUpdateBytes;
      const descriptor = await download(this.config.feed ?? "", 64 * 1024);
      let raw: unknown;
      try { raw = JSON.parse(Buffer.from(descriptor).toString("utf8")); }
      catch { throw new UpdateVerificationError("invalid_manifest", "update feed is not valid JSON"); }
      const release = verifyRelease(this.config, raw, this.trust);
      const bytes = await download(release.url, release.size);
      verifyUpdate(this.config, release, bytes, this.trust);
      this.pending = { release, bytes };
      return { ...release };
    } finally { this.downloading = false; }
  }

  async restartToInstall(install: (release: UpdateRelease, bytes: Uint8Array) => Promise<void>): Promise<void> {
    const pending = this.pending;
    if (!pending || !this.options.restart) throw new UpdateVerificationError("download_failed", "no verified update or draft checkpoint service is available");
    verifyUpdate(this.config, pending.release, pending.bytes, this.trust);
    await restartToUpdate({
      ...this.options.restart,
      targetDraftFormat: pending.release.draftFormat,
      restart: async () => {
        await install({ ...pending.release }, Uint8Array.from(pending.bytes));
        await this.options.restart!.restart();
        this.pending = undefined;
      },
    });
  }
}
