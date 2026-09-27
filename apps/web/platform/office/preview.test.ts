import type { AssetManifest } from "@uniwork/office-engine/assets";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptPreviewMessage,
  checkAssetOrigin,
  createPreviewBridge,
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
    expect(session.iframe.srcdoc).toContain(`src="about:blank#blocked"`);
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
    expect(session.iframe.srcdoc).toContain(`src="about:blank#blocked"`);
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
    expect(session.iframe.srcdoc).toContain("about:blank#blocked");
  });
});
