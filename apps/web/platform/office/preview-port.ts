import type { AssetManifest } from "@uniwork/office-engine/assets";
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
    mount(input: PreviewMountOptions): Promise<HtmlPreviewSession> {
      const text = input.format === "md" ? options.renderMarkdown?.(input.text) : input.text;
      if (text === undefined) return Promise.reject(new Error("preview runtime is unavailable for Markdown"));
      return mountHtmlPreview({
        container: input.container,
        title: input.title,
        text,
        manifest: input.manifest as AssetManifest,
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
