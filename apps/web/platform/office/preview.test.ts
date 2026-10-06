import type { AssetManifest } from "@uniwork/office-engine/assets";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptInspectorMessage,
  acceptPreviewMessage,
  checkAssetOrigin,
  createInspectorSession,
  createPreviewBridge,
  inspectorEvent,
  mountHtmlPreview,
  previewCsp,
  previewSandbox,
  type PreviewAssetProxy,
  type PreviewAssetScopeRequest,
  type PreviewCapability,
  type PreviewEvent,
} from "./preview";

const APP = "http://localhost:3000";
const PROXY_ORIGIN = "https://preview-assets.example";
const SHA = "c".repeat(64);
const MANIFEST: AssetManifest = {
  version: 1,
  document_path: "index.html",
  entries: [
    { key: "img/a b.png", sha256: SHA, byte_length: 1, media_type: "image/png", origin: "imported" },
    { key: "js/app.js", sha256: SHA, byte_length: 1, media_type: "text/javascript", origin: "imported" },
  ],
};

/** Test fake of the asset proxy contract: one document/job, bounded life, granted keys only. */
function fakeProxy(options: { origin?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const opened: PreviewAssetScopeRequest[] = [];
  let revoked = 0;
  const proxy: PreviewAssetProxy = {
    async open(request) {
      opened.push(request);
      const expires_at = now() + request.ttl_ms;
      const granted = new Set(request.keys);
      let live = true;
      const scopeId = request.document_id + "." + request.job_id;
      return {
        origin: options.origin ?? PROXY_ORIGIN,
        expires_at,
        urlFor(key) {
          if (!live || now() >= expires_at || !granted.has(key)) return null;
          return (options.origin ?? PROXY_ORIGIN) + "/s/" + scopeId + "/" + encodeURIComponent(key);
        },
        revoke() {
          live = false;
          revoked++;
        },
      };
    },
  };
  return { proxy, opened, revoked: () => revoked };
}

async function mount(text: string, extra: { capability?: PreviewCapability; proxy?: PreviewAssetProxy; onEvent?: (e: PreviewEvent) => void } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const session = await mountHtmlPreview({
    container,
    title: "Xem trước",
    text,
    manifest: MANIFEST,
    scope: { document_id: "D1", job_id: "J1", ttl_ms: 60_000 },
    proxy: extra.proxy ?? fakeProxy().proxy,
    capability: extra.capability,
    color_scheme: "dark",
    onEvent: extra.onEvent,
    appOrigin: APP,
  });
  return { container, session };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("preview sandbox and policy", () => {
  it("never grants same-origin, top navigation, popups, forms or downloads", () => {
    expect(previewSandbox(undefined)).toBe("");
    expect(previewSandbox({ scripts: false })).toBe("");
    const sneaky = { scripts: true, sandbox: "allow-same-origin allow-top-navigation" } as unknown as PreviewCapability;
    expect(previewSandbox(sneaky)).toBe("allow-scripts");
  });

  it("blocks every network path except the scoped asset origin", () => {
    const csp = previewCsp(PROXY_ORIGIN, { scripts: false });
    const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));
    expect(directives).toMatchObject({
      "default-src": "'none'",
      "connect-src": "'none'",
      "script-src": "'none'",
      "frame-src": "'none'",
      "form-action": "'none'",
      "base-uri": "'none'",
      "img-src": PROXY_ORIGIN + " data:",
      "media-src": PROXY_ORIGIN,
    });
    expect(csp).not.toMatch(/\*|https?:(?!\/\/preview-assets\.example)/);
    expect(previewCsp(PROXY_ORIGIN, { scripts: true })).toContain("script-src " + PROXY_ORIGIN + " 'unsafe-inline'");
    expect(previewCsp(null, undefined)).toContain("media-src 'none'");
  });

  it.each([
    ["the app origin", APP],
    ["the app origin with a trailing slash", APP + "/"],
    ["plain http", "http://assets.example"],
    ["a path", PROXY_ORIGIN + "/s/1"],
    ["garbage", "not a url"],
  ])("refuses an asset proxy on %s", (_name, origin) => {
    expect(() => checkAssetOrigin(origin, APP)).toThrow(expect.objectContaining({ name: "PreviewIsolationError" }));
  });

  it("allows https and loopback http proxy origins", () => {
    expect(checkAssetOrigin(PROXY_ORIGIN + "/", APP)).toBe(PROXY_ORIGIN);
    expect(checkAssetOrigin("http://127.0.0.1:5631", APP)).toBe("http://127.0.0.1:5631");
  });
});

describe("preview bridge", () => {
  const NONCE = "n0nce";

  it.each([
    ["no nonce", { data: { type: "ready" } }],
    ["a wrong nonce", { data: { type: "ready", nonce: "other" } }],
    ["an empty nonce", { data: { type: "ready", nonce: "" }, nonce: "" }],
    ["origin null", { data: { type: "ready", nonce: NONCE }, origin: "null" }],
    ["an unknown type", { data: { type: "navigate", nonce: NONCE } }],
    ["a smuggled url", { data: { type: "ready", nonce: NONCE, url: "https://evil.example" } }],
    ["a path field on resize", { data: { type: "resize", nonce: NONCE, height: 10, path: "C:\\x" } }],
    ["a bad height", { data: { type: "resize", nonce: NONCE, height: "10" } }],
    ["a negative height", { data: { type: "resize", nonce: NONCE, height: -1 } }],
    ["a non-object", { data: "ready" }],
    ["an array", { data: [NONCE] }],
  ])("rejects a message with %s", (_name, event) => {
    expect(acceptPreviewMessage(event, (event as { nonce?: string }).nonce ?? NONCE)).toBeNull();
  });

  it("accepts nonce-bearing ready and clamped resize messages", () => {
    expect(acceptPreviewMessage({ data: { type: "ready", nonce: NONCE }, origin: "" }, NONCE)).toEqual({ type: "ready" });
    expect(acceptPreviewMessage({ data: { type: "resize", nonce: NONCE, height: 12.6 } }, NONCE)).toEqual({ type: "resize", height: 13 });
    expect(acceptPreviewMessage({ data: { type: "resize", nonce: NONCE, height: 1e12 } }, NONCE)).toEqual({ type: "resize", height: 1_000_000 });
  });

  it("delivers only valid port messages and stops after close", async () => {
    const events: PreviewEvent[] = [];
    const bridge = createPreviewBridge(NONCE, (e) => events.push(e));
    bridge.remote.postMessage({ type: "ready" });
    bridge.remote.postMessage({ type: "ready", nonce: NONCE });
    await vi.waitFor(() => expect(events).toEqual([{ type: "ready" }]));
    bridge.close();
    bridge.remote.postMessage({ type: "ready", nonce: NONCE });
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(1);
    bridge.remote.close();
  });
});

describe("mountHtmlPreview", () => {
  it("renders an isolated frame with the scoped copy and leaves app secrets out", async () => {
    document.cookie = "uw_session=SECRET-COOKIE";
    window.localStorage.setItem("uw_token", "SECRET-STORAGE");
    const { proxy, opened } = fakeProxy();
    const { session } = await mount(`<!doctype html><img src="img/a%20b.png"><img src="https://tracker.example/p.gif"><a href="https://evil.example" target="_top">x</a>`, { proxy });
    const frame = session.iframe;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("csp")).toContain("connect-src 'none'");
    expect(frame.hasAttribute("credentialless")).toBe(true);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toContain("clipboard-read 'none'");
    expect(frame.getAttribute("title")).toBe("Xem trước");
    const doc = frame.srcdoc;
    expect(doc).toContain(`src="${PROXY_ORIGIN}/s/D1.J1/img%2Fa%20b.png"`);
    expect(doc).not.toContain("tracker.example");
    expect(doc).not.toContain("evil.example");
    expect(doc).toContain('<meta name="color-scheme" content="dark">');
    expect(doc).not.toContain("<script");
    expect(doc).not.toMatch(/SECRET|uw_session|uw_token/);
    expect(doc).not.toContain(session.nonce);
    expect(opened).toEqual([{ document_id: "D1", job_id: "J1", ttl_ms: 60_000, keys: ["img/a b.png", "js/app.js"] }]);
  });

  it("signals ready from the host load event when scripts are off, never from messages", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", { onEvent: (e) => events.push(e) });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "ready", nonce: session.nonce }, origin: "null" }));
    window.dispatchEvent(new MessageEvent("message", { data: { type: "resize", nonce: session.nonce, height: 5 }, origin: APP }));
    expect(events).toEqual([]);
    session.iframe.dispatchEvent(new Event("load"));
    expect(events).toEqual([{ type: "ready" }]);
  });

  it("hands a nonce-bound port to the frame only when scripts are on", async () => {
    const { session } = await mount("<p>x</p>", { capability: { scripts: true } });
    expect(session.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(session.iframe.srcdoc).toContain("<script>(function(){");
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    const [message, target, transfer] = post.mock.calls[0] as unknown as [unknown, string, MessagePort[]];
    expect(message).toEqual({ type: "uniwork-preview:init", nonce: session.nonce });
    expect(target).toBe("*");
    expect(transfer).toHaveLength(1);
    expect(session.nonce).toMatch(/^[0-9a-f]{32}$/);
    transfer[0]!.close();
    session.dispose();
  });

  it("withholds the bridge from a document that navigated its own frame, and blanks it", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", { capability: { scripts: true }, onEvent: (e) => events.push(e) });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    const transfers = () => post.mock.calls.map((c) => (c as unknown as [unknown, string, MessagePort[]])[2]![0]!);
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    // A load we did not cause by assigning srcdoc: the document navigated itself.
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "navigated" }]);
    expect(session.iframe.srcdoc).toBe("");
    // The blank page's own load is expected and gets nothing either.
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    // A host re-render is a new document and gets a fresh port.
    await session.update("<p>y</p>");
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(2);
    for (const port of transfers()) port.close();
    session.dispose();
  });

  it("reopens the scope when an update brings asset keys it has not granted", async () => {
    const fake = fakeProxy();
    const { session } = await mount(`<img src="img/a%20b.png">`, { proxy: fake.proxy });
    const next: AssetManifest = {
      ...MANIFEST,
      entries: [...MANIFEST.entries, { key: "img/new.png", sha256: SHA, byte_length: 1, media_type: "image/png", origin: "owned" }],
    };
    await session.update(`<img src="img/new.png"><img src="img/a%20b.png">`, next);
    expect(fake.opened).toHaveLength(2);
    expect(fake.opened[1]!.keys).toContain("img/new.png");
    expect(fake.revoked()).toBe(1);
    expect(session.iframe.srcdoc).toContain(PROXY_ORIGIN + "/s/D1.J1/img%2Fnew.png");
    // A subset needs no new grant.
    await session.update("<p>z</p>", MANIFEST);
    expect(fake.opened).toHaveLength(2);
    session.dispose();
    expect(fake.revoked()).toBe(2);
  });

  it("uses the updated manifest ids when reopening a scope", async () => {
    const opened: PreviewAssetScopeRequest[] = [];
    const initial = {
      ...MANIFEST,
      entries: [{ ...MANIFEST.entries[0], asset_id: "asset-old" }],
    } as unknown as AssetManifest;
    const proxy: PreviewAssetProxy = {
      async open(request) {
        opened.push(request);
        return {
          origin: PROXY_ORIGIN,
          expires_at: Date.now() + 60_000,
          urlFor: (key) => PROXY_ORIGIN + "/" + encodeURIComponent(key),
          revoke() {},
        };
      },
    };
    const container = document.createElement("div");
    const session = await mountHtmlPreview({
      container,
      title: "X",
      text: "<p>old</p>",
      manifest: initial,
      scope: { document_id: "D1", job_id: "J1" },
      proxy,
      appOrigin: APP,
    });
    const next = {
      ...initial,
      entries: [...initial.entries, { ...MANIFEST.entries[1], asset_id: "asset-new" }],
    } as AssetManifest;
    await session.update("<img src=\"js/app.js\">", next);
    expect(opened[0]?.asset_ids).toEqual({ "img/a b.png": "asset-old" });
    expect(opened[1]?.asset_ids).toEqual({ "img/a b.png": "asset-old", "js/app.js": "asset-new" });
    session.dispose();
  });

  it("refuses a reopened scope on another origin and keeps the old grant", async () => {
    let origin = PROXY_ORIGIN;
    let revoked = 0;
    const proxy: PreviewAssetProxy = {
      async open(req) {
        const o = origin;
        return { origin: o, expires_at: Date.now() + 60_000, urlFor: (k) => (req.keys.includes(k) ? o + "/" + encodeURIComponent(k) : null), revoke: () => void revoked++ };
      },
    };
    const { session } = await mount(`<img src="img/a%20b.png">`, { proxy });
    origin = "https://other-assets.example";
    const before = session.iframe.srcdoc;
    const next: AssetManifest = { ...MANIFEST, entries: [{ key: "img/x.png", sha256: SHA, byte_length: 1, media_type: "image/png", origin: "owned" }] };
    await expect(session.update("<p/>", next)).rejects.toMatchObject({ name: "PreviewIsolationError" });
    expect(revoked).toBe(1);
    expect(session.iframe.srcdoc).toBe(before);
    session.dispose();
  });

  it("revokes a scope that was reopened after dispose", async () => {
    let release: () => void = () => {};
    let opens = 0;
    const revokedIds: number[] = [];
    const proxy: PreviewAssetProxy = {
      async open(req) {
        const id = ++opens;
        if (id === 2) await new Promise<void>((r) => (release = r));
        return { origin: PROXY_ORIGIN, expires_at: Date.now() + 60_000, urlFor: (k) => (req.keys.includes(k) ? PROXY_ORIGIN + "/" + k : null), revoke: () => void revokedIds.push(id) };
      },
    };
    const { session } = await mount("<p/>", { proxy });
    const next: AssetManifest = { ...MANIFEST, entries: [{ key: "img/late.png", sha256: SHA, byte_length: 1, media_type: "image/png", origin: "owned" }] };
    const pending = session.update("<p>late</p>", next);
    await vi.waitFor(() => expect(opens).toBe(2));
    session.dispose();
    release();
    await pending;
    expect(revokedIds.sort()).toEqual([1, 2]);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("defaults the app origin and TTL, blocks keys the proxy withholds, ignores updates after dispose", async () => {
    const opened: PreviewAssetScopeRequest[] = [];
    const proxy: PreviewAssetProxy = {
      async open(req) {
        opened.push(req);
        return { origin: PROXY_ORIGIN, expires_at: Date.now() + req.ttl_ms, urlFor: (k) => (k === "js/app.js" ? PROXY_ORIGIN + "/js" : null), revoke() {} };
      },
    };
    const container = document.createElement("div");
    const session = await mountHtmlPreview({
      container,
      title: "t",
      text: `<img src="img/a%20b.png">`,
      manifest: MANIFEST,
      scope: { document_id: "D1", job_id: "J1" },
      proxy,
    });
    expect(opened[0]!.ttl_ms).toBe(10 * 60 * 1000);
    expect(session.iframe.srcdoc).not.toContain("about:blank#blocked");
    expect(session.iframe.srcdoc).not.toContain("a%20b.png");
    expect(session.iframe.srcdoc).not.toContain("a b.png");
    session.dispose();
    const before = session.iframe.srcdoc;
    await session.update("<p>after</p>");
    expect(session.iframe.srcdoc).toBe(before);
  });

  it("lets only the latest of overlapping updates render and hold the grant", async () => {
    let release: () => void = () => {};
    let opens = 0;
    const revokedIds: number[] = [];
    const proxy: PreviewAssetProxy = {
      async open(req) {
        const id = ++opens;
        if (id === 2) await new Promise<void>((r) => (release = r));
        return {
          origin: PROXY_ORIGIN,
          expires_at: Date.now() + 60_000,
          urlFor: (k) => (req.keys.includes(k) ? PROXY_ORIGIN + "/g" + id + "/" + encodeURIComponent(k) : null),
          revoke: () => void revokedIds.push(id),
        };
      },
    };
    const { session } = await mount("<p>v0</p>", { proxy });
    const next: AssetManifest = {
      ...MANIFEST,
      entries: [...MANIFEST.entries, { key: "img/new.png", sha256: SHA, byte_length: 1, media_type: "image/png", origin: "owned" }],
    };
    const first = session.update(`<p>v1</p><img src="img/new.png">`, next);
    await vi.waitFor(() => expect(opens).toBe(2));
    // A later text-only update keeps the requested manifest, so it needs (and gets) its own grant.
    await session.update(`<p>v2</p><img src="img/new.png">`);
    expect(opens).toBe(3);
    expect(session.iframe.srcdoc).toContain("<p>v2</p>");
    expect(session.iframe.srcdoc).toContain(PROXY_ORIGIN + "/g3/img%2Fnew.png");
    release();
    await first;
    // The overtaken update neither rendered nor replaced the newer grant.
    expect(session.iframe.srcdoc).toContain("<p>v2</p>");
    expect(session.iframe.srcdoc).not.toContain("<p>v1</p>");
    expect(revokedIds.sort()).toEqual([1, 2]);
    session.dispose();
    expect(revokedIds.sort()).toEqual([1, 2, 3]);
  });

  it("blocks an asset whose proxy URL does not parse", async () => {
    const proxy: PreviewAssetProxy = {
      async open() {
        return { origin: PROXY_ORIGIN, expires_at: Date.now() + 60_000, urlFor: () => "::not a url::", revoke() {} };
      },
    };
    const { session } = await mount(`<img src="img/a%20b.png">`, { proxy });
    expect(session.iframe.srcdoc).not.toContain("about:blank#blocked");
    expect(session.iframe.srcdoc).not.toContain("a%20b.png");
    expect(session.iframe.srcdoc).not.toContain("a b.png");
  });

  it("shows an empty document and raises refused when the final gate cannot prove the copy", async () => {
    const real = DOMParser.prototype.parseFromString;
    let calls = 0;
    // Second parse = the gate's re-parse: make it disagree with the first.
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text, type) {
      calls++;
      return real.call(this, calls === 2 ? "<p>other</p>" : text, type);
    });
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: "refused", reason: "unstable_serialisation" }]);
    expect(session.iframe.srcdoc).toBe("");
    // Its load is expected and gets no ready and no bridge.
    session.iframe.dispatchEvent(new Event("load"));
    expect(events).toHaveLength(1);
  });

  it("refuses a proxy that shares the app origin and revokes its scope", async () => {
    const shared = fakeProxy({ origin: APP });
    await expect(mount("<p>x</p>", { proxy: shared.proxy })).rejects.toMatchObject({ name: "PreviewIsolationError" });
    expect(shared.revoked()).toBe(1);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("stops granting assets once the scope expires, and revokes on dispose", async () => {
    let now = 1_000;
    const fake = fakeProxy({ now: () => now });
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { session } = await mount(`<img src="img/a%20b.png">`, { proxy: fake.proxy });
    expect(session.iframe.srcdoc).toContain(PROXY_ORIGIN + "/s/");
    now += 60_000;
    await session.update(`<img src="img/a%20b.png">`);
    expect(session.iframe.srcdoc).not.toContain(PROXY_ORIGIN + "/s/");
    session.dispose();
    expect(fake.revoked()).toBe(1);
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("ignores a proxy URL on a foreign origin", async () => {
    const proxy: PreviewAssetProxy = {
      async open() {
        return { origin: PROXY_ORIGIN, expires_at: Date.now() + 60_000, urlFor: () => "https://evil.example/x.png", revoke() {} };
      },
    };
    const { session } = await mount(`<img src="img/a%20b.png">`, { proxy });
    expect(session.iframe.srcdoc).not.toContain("evil.example");
    await session.update(`<img src="img/a%20b.png">`, { ...MANIFEST, entries: [] });
    expect(session.iframe.srcdoc).not.toContain("about:blank#blocked");
    expect(session.iframe.srcdoc).not.toContain("a%20b.png");
    expect(session.iframe.srcdoc).not.toContain("a b.png");
  });

  it("renders a blocked image as its alt text so the frame makes no request the CSP must refuse", async () => {
    const { session } = await mount(`<img src="pic.png" alt="Fixture"><img src="https://evil.example/a.png" srcset="pic.png 2x" alt="Remote"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline">`);
    const doc = new DOMParser().parseFromString(session.iframe.srcdoc, "text/html");
    const images = Array.from(doc.querySelectorAll("img"));
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(["Inline"]);
    expect(images[0]!.getAttribute("src")).toMatch(/^data:image\/png/);
    const blocked = Array.from(doc.querySelectorAll("span[data-blocked-image]"));
    expect(blocked.map((span) => span.textContent)).toEqual(["Fixture", "Remote"]);
    expect(blocked.every((span) => !span.hasAttribute("src") && !span.hasAttribute("srcset"))).toBe(true);
    expect(session.iframe.srcdoc).not.toContain("about:blank#blocked");
    expect(session.iframe.srcdoc).not.toContain("evil.example");
  });
});

// --- ADR 0027: visual-edit inspector escape tests ---------------------------
//
// The whole point of the decision is that exactly one script runs in the frame
// and the document still cannot. Each case below is a hostile document and the
// claim it tries to break; the assertions read the REAL srcdoc the frame gets
// (after the engine copy, the gate and the inspector injection), so they prove
// the copy, not a mock.

const VISUAL_NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("visual-edit inspector (ADR 0027)", () => {
  it("adds allow-scripts but never allow-same-origin, and a nonce CSP", async () => {
    const { session } = await mount("<p>x</p>", { capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } } });
    expect(session.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(session.iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    const csp = session.iframe.getAttribute("csp") ?? "";
    const directives = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1).join(" ")]));
    expect(directives["script-src"]).toBe("https://preview-assets.example 'nonce-" + VISUAL_NONCE + "'");
    expect(directives["script-src"]).not.toContain("unsafe-inline");
    expect(directives["script-src"]).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    // iframe[csp] is Chromium-only; Firefox/Safari enforce the in-document
    // meta, so pin the policy that actually ships in the srcdoc (SEC F10).
    const metaCsp = previewCsp(PROXY_ORIGIN, { scripts: false, visualEdit: { nonce: VISUAL_NONCE } })
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
    expect(session.iframe.srcdoc).toContain('<meta http-equiv="Content-Security-Policy" content="' + metaCsp + '">');
    session.dispose();
  });

  it("keeps a plain preview and a scripts:true preview byte-identical to today", async () => {
    const plain = await mount("<p>x</p>");
    expect(plain.session.iframe.getAttribute("sandbox")).toBe("");
    expect(plain.session.iframe.getAttribute("csp")).toContain("script-src 'none'");
    expect(plain.session.iframe.srcdoc).not.toContain("<script");
    plain.session.dispose();

    const trusted = await mount("<p>x</p>", { capability: { scripts: true } });
    expect(trusted.session.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(trusted.session.iframe.getAttribute("csp")).toContain("script-src " + PROXY_ORIGIN + " 'unsafe-inline'");
    // The trusted path keeps the old bridge bootstrap, not the inspector.
    expect(trusted.session.iframe.srcdoc).toContain("uniwork-preview:init");
    expect(trusted.session.iframe.srcdoc).not.toContain("data-sid");
    trusted.session.dispose();
  });

  it("refuses a mount with a malformed nonce instead of rendering a frame", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const fake = fakeProxy();
    await expect(mountHtmlPreview({
      container,
      title: "X",
      text: "<p>x</p>",
      manifest: MANIFEST,
      scope: { document_id: "D1", job_id: "J1" },
      proxy: fake.proxy,
      capability: { scripts: false, visualEdit: { nonce: "not-a-nonce" } },
      appOrigin: APP,
    })).rejects.toMatchObject({ name: "PreviewIsolationError" });
    expect(container.querySelector("iframe")).toBeNull();
    // The nonce is validated BEFORE the asset scope opens, so a refused mount
    // leaves no live grant behind (SEC F3).
    expect(fake.opened).toEqual([]);
    expect(fake.revoked()).toBe(0);
  });

  // Each hostile document, and the exact thing it is trying to do.
  const HOSTILE: ReadonlyArray<readonly [string, string]> = [
    ["a document script", `<p>hi</p><script>parent.postMessage({type:"select",nonce:"${VISUAL_NONCE}",sid:1},"*")</script>`],
    ["an uppercase SCRIPT element", `<SCRIPT>parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}"},"*")</SCRIPT>`],
    ["a math-namespace script", `<math><script>parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}"},"*")</script></math>`],
    ["a script inside a template", `<template><script>parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}"},"*")</script></template>`],
    ["a document nonce-bearing script (the ADR-named forgery)", `<script nonce="${VISUAL_NONCE}">parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}"},"*")</script>`],
    ["a document CSP meta", `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`],
    ["an svg onbegin handler", `<svg><animate onbegin="parent.postMessage({type:'ready',nonce:'${VISUAL_NONCE}'},'*')" attributeName="x" dur="1s"></animate></svg>`],
    ["a script that posts with a guessed nonce", `<script>parent.postMessage({type:"ready",nonce:"00000000000000000000000000000000"},"*")</script>`],
    ["a script that reads document.cookie", `<script>parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}",cookie:document.cookie},"*")</script>`],
    ["an inline on* handler", `<div onclick="parent.postMessage({type:'select',nonce:'${VISUAL_NONCE}',sid:1},'*')">c</div>`],
    ["an svg onload handler", `<svg onload="parent.postMessage({type:'ready',nonce:'${VISUAL_NONCE}'},'*')"></svg>`],
    ["a javascript: URL", `<a href="javascript:parent.postMessage({type:'ready',nonce:'${VISUAL_NONCE}'},'*')">j</a>`],
    ["a <base>", `<base href="https://evil.example/">`],
    ["an iframe", `<iframe src="https://evil.example/x"></iframe>`],
    ["an object", `<object data="https://evil.example/o.svg"></object>`],
    ["an embed", `<embed src="https://evil.example/e.svg">`],
  ];

  it.each(HOSTILE)("strips %s before the copy reaches the frame", (_name, text) => {
    return mount(text, { capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } } }).then(({ session }) => {
      const doc = session.iframe.srcdoc;
      // The document's own script/handler/loader is gone; the ONLY script left
      // is the host's inspector, which carries the nonce attribute.
      const scripts = doc.match(/<script\b[^>]*>/gi) ?? [];
      expect(scripts).toHaveLength(1);
      expect(scripts[0]).toBe('<script nonce="' + VISUAL_NONCE + '">');
      expect(doc).not.toMatch(/\son[a-z]+\s*=/i);
      expect(doc).not.toMatch(/javascript:/i);
      expect(doc).not.toMatch(/<base\b|<iframe\b|<object\b|<embed\b/i);
      expect(doc).not.toContain("evil.example");
      session.dispose();
    });
  });

  it("sends the port to the frame on load and refuses a forged inbound message", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", {
      capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } },
      onEvent: (e) => events.push(e),
    });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    const [message, target, transfer] = post.mock.calls[0] as unknown as [unknown, string, MessagePort[]];
    expect(message).toEqual({ type: "uniwork-preview:init", nonce: VISUAL_NONCE });
    expect(target).toBe("*");
    expect(transfer).toHaveLength(1);
    // The parent port accepts only schema-valid, nonce-matching messages.
    const port = transfer[0]!;
    const remote = session.inspector;
    expect(remote).not.toBeNull();
    // A forged ready with a guessed nonce never becomes an event.
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: "f".repeat(32) }, origin: "" }, VISUAL_NONCE)).toBeNull();
    const accepted = acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE }, origin: "" }, VISUAL_NONCE);
    expect(accepted).not.toBeNull();
    expect(inspectorEvent(accepted!)).toEqual({ type: "ready" });
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE, url: "https://evil.example" }, origin: "" }, VISUAL_NONCE)).toBeNull();
    port.close();
    session.dispose();
  });

  it("traverses the channel: a command reaches the frame endpoint, not the parent gate (SEC F1)", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", {
      capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } },
      onEvent: (e) => events.push(e),
    });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The endpoint the host transfers to the frame is the one the inspector
    // receives; the parent keeps the other end and must send on THAT one.
    const frameSidePort = (post.mock.calls[0] as unknown as [unknown, string, MessagePort[]])[2][0]!;
    const frameSide: unknown[] = [];
    frameSidePort.onmessage = (event: MessageEvent) => frameSide.push(event.data);
    const inspector = session.inspector;
    expect(inspector).not.toBeNull();
    expect(inspector!.command({ type: "select", sid: 4 })).toBe(true);
    // The command must arrive on the frame-side endpoint...
    await vi.waitFor(() => expect(frameSide).toEqual([{ type: "select", nonce: VISUAL_NONCE, sid: 4 }]));
    // ...and must NOT loop back into the parent's own inbound gate as if the
    // frame had sent it (the jsdom fabrication the old wiring produced).
    expect(events).toEqual([]);
    frameSidePort.close();
    session.dispose();
  });

  it("retires the inspector channel at re-render time and hands out a fresh live one (FE-M5)", async () => {
    const { session } = await mount("<p>x</p>", { capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } } });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    session.iframe.dispatchEvent(new Event("load"));
    const first = session.inspector;
    expect(first).not.toBeNull();
    // show() runs synchronously inside update(), so the old session is retired
    // before update() resolves: no caller can hold a session whose channel is
    // already dead in the window between update() and the next load.
    const pending = session.update("<p>y</p>");
    expect(session.inspector).toBeNull();
    expect(first!.command({ type: "select", sid: 1 })).toBe(false);
    // The re-render's load builds a new, live session on the same nonce.
    session.iframe.dispatchEvent(new Event("load"));
    expect(session.inspector).not.toBeNull();
    expect(session.inspector!.command({ type: "select", sid: 2 })).toBe(true);
    session.dispose();
    await pending;
  });

  it("re-strips, re-injects and rotates the channel on a visual-edit update()", async () => {
    const { session } = await mount("<p>x</p>", { capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } } });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    const firstPort = (post.mock.calls[0] as unknown as [unknown, string, MessagePort[]])[2][0]!;
    // The update source carries its own script: the re-render must strip it and
    // inject the inspector again, and the channel must be a new one.
    await session.update(`<p>y</p><script>parent.postMessage({type:"ready",nonce:"${VISUAL_NONCE}"},"*")</script>`);
    const doc = session.iframe.srcdoc;
    expect((doc.match(/<script\b/gi) ?? [])).toHaveLength(1);
    expect(doc).toContain('<script nonce="' + VISUAL_NONCE + '">');
    expect(doc).not.toContain("parent.postMessage");
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(2);
    const secondPort = (post.mock.calls[1] as unknown as [unknown, string, MessagePort[]])[2][0]!;
    expect(secondPort).not.toBe(firstPort);
    firstPort.close();
    secondPort.close();
    session.dispose();
  });

  it("refuses inspector events that fail the schema and never evaluates frame data", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", {
      capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } },
      onEvent: (e) => events.push(e),
    });
    session.iframe.dispatchEvent(new Event("load"));
    const inspector = session.inspector;
    expect(inspector).not.toBeNull();
    // A command with an out-of-range sid is dropped before it leaves the app.
    expect(inspector!.command({ type: "select", sid: -1 })).toBe(false);
    expect(inspector!.command({ type: "select", sid: 4 })).toBe(true);
    expect(inspector!.command({ type: "begin-text-edit", sid: 2 ** 40 })).toBe(false);
    session.dispose();
    // After dispose the channel is closed: no further command is sent.
    expect(inspector!.command({ type: "cancel-text-edit" })).toBe(false);
  });
});

describe("inspector message gate and event projection (ADR 0027)", () => {
  it("requires the port origin (empty), refusing an opaque window origin or a missing one", () => {
    // A MessagePort message carries origin ""; the sandboxed frame's window
    // messages carry "null". Only the port shape may pass this gate.
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE }, origin: "" }, VISUAL_NONCE)).toMatchObject({ type: "ready" });
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE }, origin: "null" }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE }, origin: APP }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE } }, VISUAL_NONCE)).toBeNull();
  });

  it("refuses a non-object, array, nonce-less or extra-key message", () => {
    expect(acceptInspectorMessage({ data: "ready", origin: "" }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: null, origin: "" }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: [VISUAL_NONCE], origin: "" }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: { type: "ready" }, origin: "" }, VISUAL_NONCE)).toBeNull();
    expect(acceptInspectorMessage({ data: { type: "ready", nonce: VISUAL_NONCE, url: "x" }, origin: "" }, VISUAL_NONCE)).toBeNull();
  });

  it("projects every declared inspector message type, and refuses an unknown one", () => {
    const project = (message: unknown) => {
      const accepted = acceptInspectorMessage({ data: message, origin: "" }, VISUAL_NONCE);
      expect(accepted).not.toBeNull();
      return inspectorEvent(accepted!);
    };
    expect(project({ type: "ready", nonce: VISUAL_NONCE })).toEqual({ type: "ready" });
    expect(project({ type: "resize", nonce: VISUAL_NONCE, height: 40 })).toEqual({ type: "resize", height: 40 });
    expect(project({ type: "select", nonce: VISUAL_NONCE, sid: 7 })).toEqual({ type: "select", sid: 7 });
    expect(project({ type: "hover", nonce: VISUAL_NONCE, sid: null })).toEqual({ type: "hover", sid: null });
    expect(project({ type: "rect", nonce: VISUAL_NONCE, sid: 7, rect: { x: 1, y: 2, width: 3, height: 4 } }))
      .toEqual({ type: "rect", sid: 7, rect: { x: 1, y: 2, width: 3, height: 4 } });
    expect(project({ type: "text-edit-commit", nonce: VISUAL_NONCE, sid: 7, text: "hi" }))
      .toEqual({ type: "text-edit-commit", sid: 7, text: "hi" });
    // A type the schema does not declare is refused before projection.
    expect(acceptInspectorMessage({ data: { type: "navigate", nonce: VISUAL_NONCE }, origin: "" }, VISUAL_NONCE)).toBeNull();
    // The projection's own default arm refuses rather than forwarding.
    expect(inspectorEvent({ type: "navigate" } as never)).toEqual({ type: "refused", reason: "unexpected_inspector_message" });
  });

  it("returns false when the port refuses a sealed command", () => {
    const remote = { postMessage: () => { throw new Error("port closed"); } } as unknown as MessagePort;
    const session = createInspectorSession(VISUAL_NONCE, remote);
    expect(session.command({ type: "select", sid: 1 })).toBe(false);
    session.close();
    expect(session.command({ type: "select", sid: 1 })).toBe(false);
  });

  it("blanks the frame and raises refused when the inspector cannot be injected", async () => {
    const events: PreviewEvent[] = [];
    const real = DOMParser.prototype.parseFromString;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      return real.call(this, "<html><head></head><body></body></html>", type);
    });
    const { session } = await mount("<p>x</p>", {
      capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } },
      onEvent: (e) => events.push(e),
    });
    expect(events).toEqual([{ type: "refused", reason: "inspector_injection_failed" }]);
    expect(session.iframe.srcdoc).toBe("");
    session.dispose();
  });

  it("delivers only schema-valid inspector events and drops a forged one", async () => {
    const events: PreviewEvent[] = [];
    const { session } = await mount("<p>x</p>", {
      capability: { scripts: false, visualEdit: { nonce: VISUAL_NONCE } },
      onEvent: (e) => events.push(e),
    });
    // Use the frame's REAL load (jsdom fires it after srcdoc is set), so the
    // inspector channel is the one the code created, not a re-created one.
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const transfer = (post.mock.calls[0] as unknown as [unknown, string, MessagePort[]])[2][0]!;
    // The transferred port is bidirectional: posting on it reaches the parent
    // gate, which is exactly the path a forged frame message takes.
    transfer.postMessage({ type: "select", nonce: "f".repeat(32), sid: 1 });
    transfer.postMessage({ type: "select", nonce: VISUAL_NONCE, sid: 4 });
    await vi.waitFor(() => expect(events).toContainEqual({ type: "select", sid: 4 }));
    // The forged sid 1 never becomes an event.
    expect(events.some((e) => e.type === "select" && e.sid === 1)).toBe(false);
    transfer.close();
    session.dispose();
  });

  it("hands the plain bridge to a trusted scripts-on frame on load", async () => {
    const { session } = await mount("<p>x</p>", { capability: { scripts: true } });
    const post = vi.spyOn(session.iframe.contentWindow!, "postMessage").mockImplementation(() => undefined);
    session.iframe.dispatchEvent(new Event("load"));
    expect(post).toHaveBeenCalledTimes(1);
    const transfer = (post.mock.calls[0] as unknown as [unknown, string, MessagePort[]])[2][0]!;
    transfer.close();
    session.dispose();
  });
});
