import { parseAssetManifest, type AssetManifest } from "@uniwork/office-engine/assets";
import { createPreviewScope } from "@uniwork/core/api/endpoints/office";
import { mountHtmlPreview, type HtmlPreviewSession, type MountHtmlPreviewOptions, type PreviewAssetProxy, type PreviewEvent } from "./preview";

interface PreviewMountInput {
  container: HTMLElement;
  format: "md" | "html";
  title: string;
  text: string;
  manifest: { entries: readonly unknown[] };
  onEvent?(event: PreviewEvent): void;
  /**
   * Visual-edit mode for the HTML editor (ADR 0026). The caller generates the
   * nonce (createInspectorNonce) so it can hold the same value for the session;
   * the port validates it and refuses the mount otherwise. Markdown never gets
   * this mode: the port drops it for `format: "md"`.
   */
  visualEdit?: { nonce: string };
}

interface IsolatedPreviewPort {
  mount(input: PreviewMountInput): Promise<HtmlPreviewSession>;
}

const PATH_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function canonicalPreviewPath(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\\") || value.includes(":") || value.startsWith("/") || value.startsWith("//") || PATH_SCHEME.test(value) || Array.from(value).some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    throw new Error("preview manifest contains an unsafe asset path");
  }
  const parts = value.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..") || parts.length === 0) throw new Error("preview manifest contains an unsafe asset path");
  return parts.join("/");
}

function previewManifest(value: { entries: readonly unknown[] }, format: "md" | "html"): AssetManifest {
  const source = value as { document_path?: unknown; entries: readonly unknown[] };
  const document_path = typeof source.document_path === "string" ? source.document_path : format === "md" ? "document.md" : "document.html";
  const entries = source.entries.map((item) => {
    if (item === null || typeof item !== "object") throw new Error("preview manifest contains an invalid asset entry");
    const record = item as Record<string, unknown>;
    const key = canonicalPreviewPath(record.key ?? record.path);
    return {
      key,
      sha256: typeof record.sha256 === "string" && /^[0-9a-f]{64}$/.test(record.sha256) ? record.sha256 : "0".repeat(64),
      byte_length: typeof record.byte_length === "number" && Number.isSafeInteger(record.byte_length) && record.byte_length >= 0 ? record.byte_length : 0,
      media_type: typeof record.media_type === "string" && record.media_type.length > 0 ? record.media_type : "application/octet-stream",
      origin: record.origin === "owned" ? "owned" as const : "imported" as const,
      ...(typeof record.assetId === "string" ? { asset_id: record.assetId } : typeof record.asset_id === "string" ? { asset_id: record.asset_id } : {}),
    };
  });
  const parsed = parseAssetManifest({ version: 1, document_path, entries });
  // parseAssetManifest intentionally keeps the engine contract narrow; the
  // host-only id survives as a non-authoritative annotation for the broker.
  parsed.entries.forEach((entry, index) => {
    const id = (entries[index] as { asset_id?: unknown }).asset_id;
    if (typeof id === "string") (entry as AssetManifestEntryWithID).asset_id = id;
  });
  return parsed;
}

interface AssetManifestEntryWithID {
  asset_id?: string;
}

/**
 * Host-side bridge used when mounting Markdown/HTML views. The view receives
 * only this port; all iframe sandbox/CSP/asset-scope policy remains in
 * preview.ts. Markdown callers must provide a real renderer that returns the
 * HTML preview copy; without it the port refuses the request so the view can
 * show “preview unavailable”.
 */
export interface OfficePreviewPortOptions {
  scope: MountHtmlPreviewOptions["scope"];
  proxy: PreviewAssetProxy;
  capability?: MountHtmlPreviewOptions["capability"];
  color_scheme?: MountHtmlPreviewOptions["color_scheme"];
  appOrigin?: string;
  renderMarkdown?: (source: string) => string;
  /**
   * Whether this port instance may mount a visual-edit session (ADR 0026). It
   * is opt-in and HTML-only: with it off (the default) a `visualEdit` request
   * is refused rather than silently downgraded, and Markdown never gets it.
   */
  allowVisualEdit?: boolean;
}

/** Real web proxy: scope creation uses the authenticated API transport, while
 * asset bytes are fetched by the credentialless frame from the configured
 * preview origin. A missing id is a typed unavailable state, never a path
 * fallback. */
export function createHttpPreviewAssetProxy(documentId: string, signal?: AbortSignal): PreviewAssetProxy {
  return {
    async open(request) {
      if (request.document_id !== documentId) throw new Error("preview unavailable: document scope mismatch");
      const assets = request.keys.map((key) => {
        const assetId = request.asset_ids?.[key];
        if (!assetId) throw new Error("preview unavailable: manifest asset id is missing");
        return { key, asset_id: assetId };
      });
      const scope = await createPreviewScope(documentId, { job_id: request.job_id, assets }, signal);
      if (!scope) throw new Error("preview unavailable: broker returned malformed scope");
      let live = true;
      const urls = new Map(scope.assets.map((asset) => [asset.key, asset.url]));
      const expiresAt = Date.parse(scope.expiresAt);
      return {
        origin: scope.origin,
        expires_at: expiresAt,
        urlFor(key: string) {
          if (!live || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
          return urls.get(key) ?? null;
        },
        revoke() {
          live = false;
        },
      };
    },
  };
}

export function createOfficePreviewPort(options: OfficePreviewPortOptions): IsolatedPreviewPort {
  return {
    async mount(input: PreviewMountInput): Promise<HtmlPreviewSession> {
      const text = input.format === "md" ? options.renderMarkdown?.(input.text) : input.text;
      if (text === undefined) return Promise.reject(new Error("preview runtime is unavailable for Markdown"));
      // ADR 0026: visual-edit is HTML-only and opt-in. A Markdown mount or a
      // port that did not allow it refuses rather than downgrading to a
      // script-free render the caller did not ask for.
      const visualEdit = input.format === "html" && input.visualEdit !== undefined;
      if (input.visualEdit !== undefined && (!visualEdit || options.allowVisualEdit !== true)) {
        return Promise.reject(new Error("preview unavailable: visual-edit is HTML-only and opt-in"));
      }
      const capability = visualEdit
        ? { scripts: false, visualEdit: input.visualEdit }
        : options.capability?.scripts === true
          ? { scripts: false }
          : options.capability;
      const session = await mountHtmlPreview({
        container: input.container,
        title: input.title,
        text,
        manifest: previewManifest(input.manifest, input.format),
        scope: options.scope,
        proxy: options.proxy,
        // G3-D2 production Markdown/HTML previews are always inert unless the
        // caller asked for the ADR 0026 visual-edit mode. The lower-level
        // isolation primitive still supports its explicit trusted script
        // policy for existing host tests, but this production port never
        // grants that capability to untrusted document content.
        capability,
        color_scheme: options.color_scheme,
        appOrigin: options.appOrigin,
        onEvent: input.onEvent,
      });
      const update = session.update.bind(session);
      return {
        ...session,
        async update(nextText: string, nextManifest?: AssetManifest) {
          const normalized = nextManifest === undefined ? undefined : previewManifest(nextManifest, input.format);
          return update(nextText, normalized);
        },
      };
    },
  };
}
