// apps/web/platform/office/preview.ts — the isolated HTML preview (G2-06).
//
// An HTML document is untrusted content. It renders in an iframe that:
//   * is sandboxed WITHOUT allow-same-origin, so it runs in an opaque origin
//     and cannot read this app's cookies, localStorage, IndexedDB or DOM;
//   * never gets allow-top-navigation*, allow-popups*, allow-forms or
//     allow-downloads; allow-scripts only when the capability asks for it;
//   * carries a CSP (in the copy and on the frame) that blocks every
//     subresource request except the scoped asset proxy origin:
//     connect-src 'none', no frames, no forms, no <base>;
//   * receives a PREVIEW COPY built by @uniwork/office-engine/html - relative
//     URLs, CSS, fonts and images are rewritten there only; the source a
//     save serialises is never touched, and the theme only adds a
//     color-scheme hint to the copy.
//
// Residual risk with scripts ON: a script can navigate its own frame to any
// URL and carry document text in it (browsers have no navigation CSP and no
// sandbox flag against self-navigation). The host then blanks the frame and
// withholds the bridge, but the request has already left - so the scripts
// capability is for documents whose author is trusted, and it is off by
// default. With scripts OFF nothing in the document can navigate: links,
// <base>, meta refresh and srcdoc are neutralised in the copy.
//
// The same limit applies to the bridge: if a script navigates the frame before
// our srcdoc document finishes loading, the next load is the new document's
// and it receives the port. Today that port only accepts ready/resize, which
// such a document can already fake; any inbound message type added later
// must not assume the sender is the rendered source.
//
// The bridge back to the app is a MessageChannel handed to the frame once
// per srcdoc render, with a per-session nonce. The app never listens to window "message"
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

import { BLOCKED_URL, buildHtmlPreviewCopy, dropBlockedResourceUrls } from "@uniwork/office-engine/html";
import type { AssetManifest } from "@uniwork/office-engine/assets";
import { gatePreviewCopy } from "./preview-gate";
import {
  assertInspectorNonce,
  injectInspector,
  inspectorInboundSchema,
  sealInspectorCommand,
  type InspectorCommand,
  type InspectorInbound,
} from "./preview-inspector";

export interface PreviewCapability {
  /** Let the document's own scripts run inside the sandbox. Default false.
   * This is the legacy trusted-document path: it relies on the CSP, not on
   * the gate, to stop scripts, so it is only for documents whose author is
   * trusted. `visualEdit` supersedes it when both are set. */
  scripts: boolean;
  /**
   * Visual-edit mode (ADR 0027, user decision 2026-10-04 option (a)). The ONLY
   * way the frame runs a script without `'unsafe-inline'`: the host injects the
   * UniWork-owned inspector AFTER the gate, the CSP becomes
   * `script-src 'nonce-<n>'`, and the gate strips every document script and
   * on* handler. The nonce is validated (32 lowercase hex) or mount fails
   * closed. The sandbox stays allow-scripts WITHOUT allow-same-origin.
   */
  visualEdit?: { nonce: string };
}

export interface PreviewAssetScopeRequest {
  document_id: string;
  job_id: string;
  ttl_ms: number;
  /** Manifest keys the preview may load; nothing else is granted. */
  keys: readonly string[];
  /** Optional manifest-key -> opaque Documents asset id mapping. */
  asset_ids?: Readonly<Record<string, string>>;
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

/** "ready"/"resize" arrive from the preview; "navigated" is raised by the host
 * when the document left the preview on its own (the frame is blanked);
 * "refused" when the final gate (preview-gate.ts) could not prove the copy
 * safe and the frame shows an empty document instead. */
export type PreviewEvent =
  | { type: "ready" }
  | { type: "resize"; height: number }
  | { type: "navigated" }
  | { type: "refused"; reason: "unstable_serialisation" | "residual_after_reparse" | "inspector_injection_failed" | "unexpected_inspector_message" }
  // Inspector events, visual-edit only. Each is rebuilt from a zod-validated
  // frame message (acceptInspectorMessage); the raw frame data never reaches
  // a caller and is never evaluated.
  | { type: "select"; sid: number | null }
  | { type: "hover"; sid: number | null }
  | { type: "rect"; sid: number; rect: InspectorRect }
  | { type: "text-edit-commit"; sid: number; text: string };

export interface InspectorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/** The session nonce for visual-edit, or a PreviewIsolationError: a mount that
 * cannot prove its nonce must not render a frame at all. */
function visualEditNonce(capability: PreviewCapability | undefined): string {
  try {
    return assertInspectorNonce(capability?.visualEdit?.nonce);
  } catch {
    throw new PreviewIsolationError("visual-edit nonce must be 32 lowercase hex characters");
  }
}

/** The ONLY sandbox tokens the preview can ever get. `allow-same-origin` is
 * never among them, in either script mode, so the frame keeps its opaque
 * origin and cannot reach app cookies, storage or DOM. */
export function previewSandbox(capability: PreviewCapability | undefined): string {
  return capability?.scripts === true || capability?.visualEdit !== undefined ? "allow-scripts" : "";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Validate the proxy origin: absolute https (http only on loopback), bare origin, not the app. */
export function checkAssetOrigin(origin: string, appOrigin: string): string {
  let url: URL;
  let appUrl: URL;
  try {
    url = new URL(origin);
    appUrl = new URL(appOrigin);
  } catch {
    throw new PreviewIsolationError("asset proxy origin is not an absolute URL");
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure) throw new PreviewIsolationError("asset proxy origin must be https");
  if (url.origin !== origin.replace(/\/$/, "")) throw new PreviewIsolationError("asset proxy origin must be a bare origin");
  if (url.origin === appUrl.origin) throw new PreviewIsolationError("asset proxy must not share the app origin");
  return url.origin;
}

/** CSP for the preview copy and the frame. `assetOrigin` has passed checkAssetOrigin. */
export function previewCsp(assetOrigin: string | null, capability: PreviewCapability | undefined): string {
  const from = assetOrigin ?? "";
  const src = (extra: string) => (from + " " + extra).trim() || "'none'";
  // Visual-edit: the ONLY script source is the host's nonce (plus the scoped
  // asset origin). No 'unsafe-inline', no 'unsafe-eval'. The nonce is asserted
  // here too, so a bad one can never reach a rendered policy.
  const scriptSrc = (() => {
    if (capability?.visualEdit !== undefined) return "script-src " + src("'nonce-" + visualEditNonce(capability) + "'");
    return capability?.scripts === true ? "script-src " + src("'unsafe-inline'") : "script-src 'none'";
  })();
  return [
    "default-src 'none'",
    "img-src " + src("data:"),
    "style-src " + src("'unsafe-inline'"),
    "font-src " + src("data:"),
    "media-src " + src(""),
    scriptSrc,
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
 * from validated fields, or null. Rejects a missing or wrong nonce, an
 * unknown type, and any extra field (so no URL or path can ride along).
 * Real port messages carry origin "" - the port and the nonce are the gates.
 * An event with origin "null" is refused outright so that no caller can ever
 * route a window message from an opaque-origin frame through this gate.
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

/**
 * The inspector gate for inbound port messages (visual-edit only). Same
 * fail-closed contract as acceptPreviewMessage, stricter: the message must be
 * a plain object (never an array), the nonce must match the session nonce
 * EXACTLY, and the zod strictObject schema must accept it - an unknown type, a
 * missing field, an extra key or an out-of-range value is refused and the
 * event is never produced. The returned event is rebuilt from validated
 * fields, so a frame cannot smuggle anything the caller would act on, and the
 * parent never evaluates frame data. Real port messages carry origin "".
 */
export function acceptInspectorMessage(event: { data: unknown; origin?: string }, nonce: string): InspectorInbound | null {
  // The handler is attached to a MessagePort, whose messages carry origin ""
  // (a real window message from the sandboxed frame carries "null"). Require
  // the port origin exactly, so a window-delivered event can never reach this
  // gate even if a future caller attaches it to a window listener.
  if (event.origin !== "") return null;
  const data = event.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  if ((data as { nonce?: unknown }).nonce !== nonce) return null;
  const parsed = inspectorInboundSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Map a validated inspector message to a PreviewEvent. The zod schema already
 * bounds every value, so this only projects the validated record - it never
 * trusts a field it did not validate. */
export function inspectorEvent(message: InspectorInbound): PreviewEvent {
  switch (message.type) {
    case "ready":
      return { type: "ready" };
    case "resize":
      return { type: "resize", height: message.height };
    case "select":
      return { type: "select", sid: message.sid };
    case "hover":
      return { type: "hover", sid: message.sid };
    case "rect":
      return { type: "rect", sid: message.sid, rect: message.rect };
    case "text-edit-commit":
      return { type: "text-edit-commit", sid: message.sid, text: message.text };
    default:
      // A type added to the schema without a case here would be a compile
      // error (never); at runtime an unknown type is refused, not forwarded.
      return { type: "refused", reason: "unexpected_inspector_message" };
  }
}

export interface InspectorSession {
  /** Send a validated command to the frame. Returns false when the session is
   * closed or the command does not pass its schema (never guesses). */
  command(command: InspectorCommand): boolean;
  close(): void;
}

export function createInspectorSession(nonce: string, remote: MessagePort): InspectorSession {
  let live = true;
  return {
    command(command) {
      if (!live) return false;
      const sealed = sealInspectorCommand(command, nonce);
      if (sealed === null) return false;
      try {
        remote.postMessage(sealed);
        return true;
      } catch {
        return false;
      }
    },
    close() {
      live = false;
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
  /** Visual-edit only: the command channel to the inspector, null in every
   * other mode. Commands are validated before they leave the app. */
  inspector: InspectorSession | null;
  /** Re-render from new source. A manifest with keys the scope has not
   * granted reopens the scope (same origin) before rendering. */
  update(text: string, manifest?: AssetManifest): Promise<void>;
  dispose(): void;
}

const DENIED_FEATURES =
  "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; " +
  "payment 'none'; usb 'none'; serial 'none'; hid 'none'; fullscreen 'none'; display-capture 'none'";

export async function mountHtmlPreview(options: MountHtmlPreviewOptions): Promise<HtmlPreviewSession> {
  const appOrigin = options.appOrigin ?? window.location.origin;
  const capability = options.capability;
  const ttl_ms = options.scope.ttl_ms ?? DEFAULT_TTL_MS;
  let manifest = options.manifest;
  const openScope = async (scopeManifest: AssetManifest, keys: string[], requiredOrigin: string | null) => {
    const assetIds = Object.fromEntries(
      scopeManifest.entries
        .map((entry) => [entry.key, (entry as AssetManifestEntryWithID).asset_id])
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
    );
    const opened = await options.proxy.open({
      document_id: options.scope.document_id,
      job_id: options.scope.job_id,
      ttl_ms,
      keys,
      ...(Object.keys(assetIds).length > 0 ? { asset_ids: assetIds } : {}),
    });
    try {
      const origin = checkAssetOrigin(opened.origin, appOrigin);
      // The CSP is fixed at mount; a reopened scope must stay on its origin.
      if (requiredOrigin !== null && origin !== requiredOrigin) {
        throw new PreviewIsolationError("asset proxy origin changed within a preview session");
      }
      return { scope: opened, origin, granted: new Set(keys) };
    } catch (error) {
      opened.revoke();
      throw error;
    }
  };

interface AssetManifestEntryWithID {
  asset_id?: unknown;
}
  // Visual-edit is validated before any render: a bad nonce fails the mount
  // (the caller gets no frame), it is never softened into a script-free copy.
  // It is validated before openScope too, so a refused mount never leaves a
  // live asset grant behind (SEC F3).
  const visual = capability?.visualEdit !== undefined;
  const nonce = visual ? visualEditNonce(capability) : newNonce();
  let current = await openScope(manifest, manifest.entries.map((e) => e.key), null);
  const assetOrigin = current.origin;
  const csp = previewCsp(assetOrigin, capability);

  const assetUrl = (key: string): string | null => {
    const { scope } = current;
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
  // Visual-edit never lets a document script through the engine policy: the
  // gate strips them below, and the engine is told scripts are off, so the
  // frame's only script is the inspector injected after the gate.
  // A blocked image keeps no src: the CSP would refuse the load and log a
  // violation per render. The gate below still proves the resulting copy.
  const render = (text: string): string =>
    dropBlockedResourceUrls(buildHtmlPreviewCopy({
      text,
      manifest,
      assetUrl,
      scripts: !visual && capability?.scripts === true,
      csp,
      color_scheme: options.color_scheme,
      head_injection: !visual && capability?.scripts === true ? BRIDGE_BOOTSTRAP : undefined,
    }));

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", previewSandbox(capability));
  iframe.setAttribute("csp", csp);
  iframe.setAttribute("credentialless", "");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("allow", DENIED_FEATURES);
  iframe.setAttribute("title", options.title);
  iframe.className = "block h-full w-full border-0 bg-background";

  // Which document the next load belongs to. Only a load WE caused by
  // assigning srcdoc may receive the bridge; any other load means the
  // document navigated its own frame (possible with scripts on: no sandbox
  // flag or CSP directive stops self-navigation), so the frame is blanked and
  // the new occupant never gets a port or the nonce (FE review r1 F-1).
  let pending: "document" | "blank" | null = null;
  let bridge: PreviewBridge | null = null;
  let inspector: InspectorSession | null = null;
  let closeInspectorChannel: (() => void) | null = null;
  // Retire the channels of the document we are about to replace. Closing at
  // srcdoc-assignment time - not only on the next load - means a caller can
  // never be handed an inspector whose channel is already dead (FE-M5).
  const retireChannels = () => {
    bridge?.close();
    bridge = null;
    inspector?.close();
    inspector = null;
    closeInspectorChannel?.();
    closeInspectorChannel = null;
  };
  const show = (text: string) => {
    retireChannels();
    // Final gate: the browser's own parser decides what the copy contains. In
    // visual-edit it also strips every <script> and on* handler, so what comes
    // out is script-free and the inspector is the only script added after it.
    const gated = gatePreviewCopy(render(text), { assetOrigin, blockedUrl: BLOCKED_URL, stripScripts: visual, csp });
    if (!gated.ok) {
      pending = "blank";
      iframe.srcdoc = "";
      options.onEvent?.({ type: "refused", reason: gated.reason });
      return;
    }
    let html = gated.html;
    if (visual) {
      // AFTER the gate, never from the document: injectInspector parses the
      // gated copy and appends the host script (with the nonce) to <head>.
      try {
        html = injectInspector(gated.html, nonce);
      } catch {
        pending = "blank";
        iframe.srcdoc = "";
        options.onEvent?.({ type: "refused", reason: "inspector_injection_failed" });
        return;
      }
    }
    pending = "document";
    iframe.srcdoc = html;
  };
  const onLoad = () => {
    const cause = pending;
    pending = null;
    retireChannels();
    if (cause === "blank") return;
    if (cause === null) {
      pending = "blank";
      iframe.srcdoc = "";
      options.onEvent?.({ type: "navigated" });
      return;
    }
    if (visual) {
      // Visual-edit: a channel whose inbound messages must pass the zod
      // schema + nonce gate. The inspector script takes the port on its own
      // init message; the parent never reads frame data, only validated events.
      const channel = new MessageChannel();
      channel.port1.onmessage = (event: MessageEvent) => {
        const accepted = acceptInspectorMessage(event, nonce);
        if (accepted) options.onEvent?.(inspectorEvent(accepted));
      };
      // The parent sends on port1; port2 is the endpoint transferred to the
      // frame. Posting on the transferred port is a silent no-op (SEC F1).
      inspector = createInspectorSession(nonce, channel.port1);
      closeInspectorChannel = () => {
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
      };
      // An opaque origin can only be addressed with "*"; the port, not the
      // origin, is the capability - and it goes to this frame's window only.
      iframe.contentWindow?.postMessage({ type: INIT_TYPE, nonce }, "*", [channel.port2]);
      return;
    }
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
  show(options.text);
  options.container.appendChild(iframe);

  let disposed = false;
  // The manifest the latest update asked for (an update without one keeps
  // it), and a counter so only the latest update renders or swaps grants.
  let requested = manifest;
  let generation = 0;
  return {
    iframe,
    nonce,
    get inspector() {
      return inspector;
    },
    async update(text, next) {
      const gen = ++generation;
      const target = next ?? requested;
      requested = target;
      const keys = target.entries.map((e) => e.key);
      if (keys.some((key) => !current.granted.has(key))) {
        // New assets (e.g. an image dropped in while editing) need a grant:
        // reopen the scope with the new key set and retire the old one.
        const reopened = await openScope(target, keys, assetOrigin);
        // A newer update or a dispose overtook this one while it waited: its
        // grant is retired at once and it neither renders nor swaps scopes,
        // so text, manifest and grant always come from the same update.
        if (disposed || gen !== generation) {
          reopened.scope.revoke();
          return;
        }
        current.scope.revoke();
        current = reopened;
      }
      if (disposed) return;
      manifest = target;
      show(text);
    },
    dispose() {
      disposed = true;
      iframe.removeEventListener("load", onLoad);
      retireChannels();
      current.scope.revoke();
      iframe.remove();
    },
  };
}
