// apps/web/platform/office/preview.ts — the isolated HTML preview (G2-06).
//
// An HTML document is untrusted content. It renders in an iframe that:
//   * is sandboxed WITHOUT allow-same-origin, so it runs in an opaque origin
//     and cannot read this app's cookies, localStorage, IndexedDB or DOM;
//   * never gets allow-top-navigation*, allow-popups*, allow-forms or
//     allow-downloads; allow-scripts only when the capability asks for it;
//   * carries a CSP (in the copy and on the frame) that blocks every network
//     request except the scoped asset proxy origin: connect-src 'none',
//     no frames, no forms, no <base>;
//   * receives a PREVIEW COPY built by @uniwork/office-engine/html - relative
//     URLs, CSS, fonts and images are rewritten there only; the source a
//     save serialises is never touched, and the theme only adds a
//     color-scheme hint to the copy.
//
// The bridge back to the app is a MessageChannel handed to the frame once,
// with a per-session nonce. The app never listens to window "message"
// events for the preview, rejects origin-null and nonce-less messages, and
// no inbound message can carry a URL or path: the app never fetches anything
// a message names.
//
// Asset proxy (contract here, real route in G2-02/G2-07 server work): a
// scope grants read access to named manifest keys of ONE document/job for a
// bounded lifetime, on an origin that is NOT the app origin, so the preview
// never reaches a credentialed app route. The server route must serve only
// scope-granted keys, with the manifest media type, `X-Content-Type-Options:
// nosniff`, no cookies (none are sent: opaque origin + credentialless frame),
// and must stop answering when the scope expires or is revoked.

import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";
import type { AssetManifest } from "@uniwork/office-engine/assets";

export interface PreviewCapability {
  /** Let the document's own scripts run inside the sandbox. Default false. */
  scripts: boolean;
}

export interface PreviewAssetScopeRequest {
  document_id: string;
  job_id: string;
  ttl_ms: number;
  /** Manifest keys the preview may load; nothing else is granted. */
  keys: readonly string[];
}

export interface PreviewAssetScope {
  /** Proxy origin, e.g. https://preview-assets.uniwork.vn - never the app origin. */
  origin: string;
  /** Epoch ms after which no URL is valid. */
  expires_at: number;
  /** Absolute URL for a granted key on `origin`, or null. */
  urlFor(key: string): string | null;
  revoke(): void;
}

export interface PreviewAssetProxy {
  open(request: PreviewAssetScopeRequest): Promise<PreviewAssetScope>;
}

export type PreviewEvent = { type: "ready" } | { type: "resize"; height: number };

/** Preview TTL when the caller names none: long enough to read, short enough to expire. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_HEIGHT = 1_000_000;
const INIT_TYPE = "uniwork-preview:init";

export class PreviewIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewIsolationError";
  }
}

/** The ONLY sandbox tokens the preview can ever get. */
export function previewSandbox(capability: PreviewCapability | undefined): string {
  return capability?.scripts === true ? "allow-scripts" : "";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validate the proxy origin: absolute https (http only on loopback), bare origin, not the app. */
export function checkAssetOrigin(origin: string, appOrigin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new PreviewIsolationError("asset proxy origin is not an absolute URL");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure) throw new PreviewIsolationError("asset proxy origin must be https");
  if (url.origin !== origin.replace(/\/$/, "")) throw new PreviewIsolationError("asset proxy origin must be a bare origin");
  if (url.origin === appOrigin) throw new PreviewIsolationError("asset proxy must not share the app origin");
  return url.origin;
}

/** CSP for the preview copy and the frame. `assetOrigin` has passed checkAssetOrigin. */
export function previewCsp(assetOrigin: string | null, capability: PreviewCapability | undefined): string {
  const from = assetOrigin ?? "";
  const src = (extra: string) => (from + " " + extra).trim() || "'none'";
  return [
    "default-src 'none'",
    "img-src " + src("data:"),
    "style-src " + src("'unsafe-inline'"),
    "font-src " + src("data:"),
    "media-src " + src(""),
    capability?.scripts === true ? "script-src " + src("'unsafe-inline'") : "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The single gate for inbound bridge messages. Returns the event, rebuilt
 * from validated fields, or null. Rejects: origin "null", a missing or wrong
 * nonce, an unknown type, and any extra field (so no URL or path can ride
 * along).
 */
export function acceptPreviewMessage(event: { data: unknown; origin?: string }, nonce: string): PreviewEvent | null {
  if (event.origin === "null") return null;
  const data = event.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (typeof record.nonce !== "string" || record.nonce.length === 0 || record.nonce !== nonce) return null;
  const keys = Object.keys(record).sort().join(",");
  if (record.type === "ready" && keys === "nonce,type") return { type: "ready" };
  if (record.type === "resize" && keys === "height,nonce,type") {
    const height = record.height;
    if (typeof height !== "number" || !Number.isFinite(height) || height < 0) return null;
    return { type: "resize", height: Math.min(Math.round(height), MAX_HEIGHT) };
  }
  return null;
}

/** Bootstrap run inside the frame (scripts capability only): take the port
 * once from the parent, echo the nonce, report height. It never reads the
 * DOM for URLs and the nonce is never written into the copy. */
const BRIDGE_BOOTSTRAP =
  "<script>(function(){var p=null;addEventListener('message',function(e){" +
  "if(p||e.source!==parent||!e.ports||!e.ports[0]||!e.data||e.data.type!=='" +
  INIT_TYPE +
  "')return;p=e.ports[0];var n=String(e.data.nonce);p.postMessage({nonce:n,type:'ready'});" +
  "var s=function(){p.postMessage({nonce:n,type:'resize',height:document.documentElement.scrollHeight})};" +
  "if(typeof ResizeObserver==='function')new ResizeObserver(s).observe(document.documentElement);s()})})();</script>";

export interface PreviewBridge {
  /** The port to transfer into the frame. */
  remote: MessagePort;
  close(): void;
}

export function createPreviewBridge(nonce: string, onEvent: (event: PreviewEvent) => void): PreviewBridge {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event: MessageEvent) => {
    const accepted = acceptPreviewMessage(event, nonce);
    if (accepted) onEvent(accepted);
  };
  return {
    remote: channel.port2,
    close() {
      channel.port1.onmessage = null;
      channel.port1.close();
    },
  };
}

export interface MountHtmlPreviewOptions {
  container: HTMLElement;
  /** Accessible name of the frame (already translated by the caller). */
  title: string;
  text: string;
  manifest: AssetManifest;
  scope: { document_id: string; job_id: string; ttl_ms?: number };
  proxy: PreviewAssetProxy;
  capability?: PreviewCapability;
  color_scheme?: "light" | "dark";
  onEvent?(event: PreviewEvent): void;
  /** Defaults to window.location.origin. */
  appOrigin?: string;
}

export interface HtmlPreviewSession {
  iframe: HTMLIFrameElement;
  nonce: string;
  /** Re-render from new source (same scope while it lasts). */
  update(text: string, manifest?: AssetManifest): void;
  dispose(): void;
}

const DENIED_FEATURES =
  "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; " +
  "payment 'none'; usb 'none'; serial 'none'; hid 'none'; fullscreen 'none'; display-capture 'none'";

export async function mountHtmlPreview(options: MountHtmlPreviewOptions): Promise<HtmlPreviewSession> {
  const appOrigin = options.appOrigin ?? window.location.origin;
  const capability = options.capability;
  let manifest = options.manifest;
  const scope = await options.proxy.open({
    document_id: options.scope.document_id,
    job_id: options.scope.job_id,
    ttl_ms: options.scope.ttl_ms ?? DEFAULT_TTL_MS,
    keys: manifest.entries.map((e) => e.key),
  });
  let assetOrigin: string;
  try {
    assetOrigin = checkAssetOrigin(scope.origin, appOrigin);
  } catch (error) {
    scope.revoke();
    throw error;
  }
  const csp = previewCsp(assetOrigin, capability);
  const nonce = newNonce();

  const assetUrl = (key: string): string | null => {
    if (Date.now() >= scope.expires_at) return null;
    const url = scope.urlFor(key);
    if (url === null) return null;
    try {
      // Defence in depth: a proxy that answers another origin is ignored.
      return new URL(url).origin === assetOrigin ? url : null;
    } catch {
      return null;
    }
  };
  const render = (text: string): string =>
    buildHtmlPreviewCopy({
      text,
      manifest,
      assetUrl,
      scripts: capability?.scripts === true,
      csp,
      color_scheme: options.color_scheme,
      head_injection: capability?.scripts === true ? BRIDGE_BOOTSTRAP : undefined,
    });

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", previewSandbox(capability));
  iframe.setAttribute("csp", csp);
  iframe.setAttribute("credentialless", "");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("allow", DENIED_FEATURES);
  iframe.setAttribute("title", options.title);
  iframe.className = "block h-full w-full border-0 bg-background";

  let bridge: PreviewBridge | null = null;
  const onLoad = () => {
    bridge?.close();
    bridge = null;
    if (capability?.scripts !== true) {
      // No script can run: the only trustworthy signal is the host's own load event.
      options.onEvent?.({ type: "ready" });
      return;
    }
    bridge = createPreviewBridge(nonce, (event) => options.onEvent?.(event));
    // An opaque origin can only be addressed with "*"; the port, not the
    // origin, is the capability - and it goes to this frame's window only.
    iframe.contentWindow?.postMessage({ type: INIT_TYPE, nonce }, "*", [bridge.remote]);
  };
  iframe.addEventListener("load", onLoad);
  iframe.srcdoc = render(options.text);
  options.container.appendChild(iframe);

  return {
    iframe,
    nonce,
    update(text, next) {
      if (next) manifest = next;
      iframe.srcdoc = render(text);
    },
    dispose() {
      iframe.removeEventListener("load", onLoad);
      bridge?.close();
      bridge = null;
      scope.revoke();
      iframe.remove();
    },
  };
}
