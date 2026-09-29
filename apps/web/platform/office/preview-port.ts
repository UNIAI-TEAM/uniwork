import { parseAssetManifest, type AssetManifest } from "@uniwork/office-engine/assets";
import { mountHtmlPreview, type HtmlPreviewSession, type MountHtmlPreviewOptions, type PreviewAssetProxy } from "./preview";

interface PreviewMountInput {
  container: HTMLElement;
  format: "md" | "html";
  title: string;
  text: string;
  manifest: { entries: readonly unknown[] };
  onEvent?(event: { type: string }): void;
}

interface IsolatedPreviewPort {
  mount(input: PreviewMountInput): Promise<HtmlPreviewSession>;
}

const PATH_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function canonicalPreviewPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/") || value.startsWith("//") || PATH_SCHEME.test(value) || Array.from(value).some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
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
    };
  });
  return parseAssetManifest({ version: 1, document_path, entries });
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
}

export function createOfficePreviewPort(options: OfficePreviewPortOptions): IsolatedPreviewPort {
  return {
    mount(input: PreviewMountInput): Promise<HtmlPreviewSession> {
      const text = input.format === "md" ? options.renderMarkdown?.(input.text) : input.text;
      if (text === undefined) return Promise.reject(new Error("preview runtime is unavailable for Markdown"));
      return mountHtmlPreview({
        container: input.container,
        title: input.title,
        text,
        manifest: previewManifest(input.manifest, input.format),
        scope: options.scope,
        proxy: options.proxy,
        capability: options.capability,
        color_scheme: options.color_scheme,
        appOrigin: options.appOrigin,
        onEvent: input.onEvent,
      });
    },
  };
}
