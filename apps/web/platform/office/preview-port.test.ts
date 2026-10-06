import { describe, expect, it } from "vitest";
import { createOfficePreviewPort } from "./preview-port";

describe("createOfficePreviewPort", () => {
  it("refuses Markdown when no renderer is injected instead of fabricating a preview", async () => {
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      proxy: { open: async () => { throw new Error("must not request an asset scope"); } },
    });
    await expect(port.mount({
      container: document.createElement("div"),
      format: "md",
      title: "Markdown",
      text: "# source",
      manifest: { entries: [] },
    })).rejects.toThrow("preview runtime is unavailable for Markdown");
  });

  it("normalises the view manifest path before opening the isolated asset scope", async () => {
    const opened: string[][] = [];
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      appOrigin: "http://localhost:3000",
      proxy: {
        open: async (request) => {
          opened.push([...request.keys]);
          return {
            origin: "https://preview-assets.example",
            expires_at: Date.now() + 60_000,
            urlFor: (key: string) => `https://preview-assets.example/${key}`,
            revoke: () => undefined,
          };
        },
      },
    });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<img src=\"assets/logo.png\">",
      manifest: { entries: [{ path: "./assets/logo.png", assetId: "asset-logo" }] },
    });
    expect(opened).toEqual([["assets/logo.png"]]);
    session.dispose();
  });

  it("rejects an unsafe manifest path before opening an asset scope", async () => {
    const open = async () => { throw new Error("asset scope must not open"); };
    const port = createOfficePreviewPort({ scope: { document_id: "D1", job_id: "J1" }, proxy: { open } });
    await expect(port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>unsafe</p>",
      manifest: { entries: [{ path: "../secret", assetId: "bad" }] },
    })).rejects.toThrow("unsafe asset path");
  });

  it("forces the production port to keep document scripts disabled", async () => {
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      capability: { scripts: true },
      proxy: {
        open: async () => ({
          origin: "https://preview-assets.example",
          expires_at: Date.now() + 60_000,
          urlFor: () => null,
          revoke: () => undefined,
        }),
      },
    });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<script>window.leak = document.cookie</script><p>safe</p>",
      manifest: { entries: [] },
    });
    expect(session.iframe.getAttribute("sandbox")).toBe("");
    expect(session.iframe.getAttribute("csp")).toContain("script-src 'none'");
    session.dispose();
  });

  it("normalises update manifests before reopening the broker scope", async () => {
    const opened: Array<{ keys: string[]; asset_ids?: Record<string, string> }> = [];
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      appOrigin: "http://localhost:3000",
      proxy: {
        open: async (request) => {
          opened.push({ keys: [...request.keys], asset_ids: request.asset_ids ? { ...request.asset_ids } : undefined });
          return {
            origin: "https://preview-assets.example",
            expires_at: Date.now() + 60_000,
            urlFor: (key: string) => `https://preview-assets.example/${key}`,
            revoke: () => undefined,
          };
        },
      },
    });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<img src=\"assets/old.png\">",
      manifest: { entries: [{ path: "assets/old.png", assetId: "asset-old" }] },
    });
    await session.update("<img src=\"assets/new.png\">", { entries: [{ path: "assets/new.png", assetId: "asset-new" }] } as never);
    expect(opened).toEqual([
      { keys: ["assets/old.png"], asset_ids: { "assets/old.png": "asset-old" } },
      { keys: ["assets/new.png"], asset_ids: { "assets/new.png": "asset-new" } },
    ]);
    session.dispose();
  });
});

describe("visual-edit mode (ADR 0027)", () => {
  const NONCE = "0123456789abcdef0123456789abcdef";
  const proxy = {
    open: async () => ({
      origin: "https://preview-assets.example",
      expires_at: Date.now() + 60_000,
      urlFor: () => null,
      revoke: () => undefined,
    }),
  };

  it("mounts an HTML visual-edit session with allow-scripts, a nonce CSP and the inspector", async () => {
    const port = createOfficePreviewPort({ scope: { document_id: "D1", job_id: "J1" }, proxy, allowVisualEdit: true });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: '<p>hi</p><script>parent.postMessage({type:"ready",nonce:"' + NONCE + '"},"*")</script>',
      manifest: { entries: [] },
      visualEdit: { nonce: NONCE },
    });
    expect(session.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(session.iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(session.iframe.getAttribute("csp")).toContain("'nonce-" + NONCE + "'");
    const doc = session.iframe.srcdoc;
    expect(doc).not.toContain("parent.postMessage");
    expect((doc.match(/<script\b/gi) ?? [])).toHaveLength(1);
    expect(doc).toContain('<script nonce="' + NONCE + '">');
    session.dispose();
  });

  it("hands out the inspector the frame has NOW, not the null it had at mount", async () => {
    // The inspector only exists after the frame's load event and is replaced on
    // every reload. The real browser repro (M01 r2): the port copied the
    // session with a spread, which froze the getter at mount time (null), so
    // "Sửa chữ" never reached the frame.
    const port = createOfficePreviewPort({ scope: { document_id: "D1", job_id: "J1" }, proxy, allowVisualEdit: true });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>hi</p>",
      manifest: { entries: [] },
      visualEdit: { nonce: NONCE },
    });
    expect(session.inspector).toBeNull();
    session.iframe.dispatchEvent(new Event("load"));
    const first = session.inspector;
    expect(first).not.toBeNull();
    expect(first?.command({ type: "begin-text-edit", sid: 1 })).toBe(true);
    await session.update("<p>again</p>");
    // The reload retires the old channel at once; the new one arrives with the load.
    expect(first?.command({ type: "begin-text-edit", sid: 1 })).toBe(false);
    session.iframe.dispatchEvent(new Event("load"));
    expect(session.inspector).not.toBeNull();
    expect(session.inspector).not.toBe(first);
    session.dispose();
  });

  it("refuses visual-edit when the port has not opted in", async () => {
    const port = createOfficePreviewPort({ scope: { document_id: "D1", job_id: "J1" }, proxy });
    await expect(port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>x</p>",
      manifest: { entries: [] },
      visualEdit: { nonce: NONCE },
    })).rejects.toThrow("visual-edit is HTML-only and opt-in");
  });

  it("strips a visualEdit member from the port options unless it opted in (SEC F4)", async () => {
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      proxy,
      capability: { scripts: false, visualEdit: { nonce: NONCE } },
    });
    const session = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>x</p>",
      manifest: { entries: [] },
    });
    // The port never opted in, so its configured capability cannot smuggle
    // visual-edit into a mount that did not ask for it.
    expect(session.iframe.getAttribute("sandbox")).toBe("");
    expect(session.iframe.getAttribute("csp")).toContain("script-src 'none'");
    expect(session.iframe.srcdoc).not.toContain("<script");
    session.dispose();
  });

  it("refuses visual-edit for Markdown even when the port allows it", async () => {
    const port = createOfficePreviewPort({
      scope: { document_id: "D1", job_id: "J1" },
      proxy,
      allowVisualEdit: true,
      renderMarkdown: (source) => "<p>" + source + "</p>",
    });
    await expect(port.mount({
      container: document.createElement("div"),
      format: "md",
      title: "Markdown",
      text: "# source",
      manifest: { entries: [] },
      visualEdit: { nonce: NONCE },
    })).rejects.toThrow("visual-edit is HTML-only and opt-in");
  });

  it("still keeps a plain preview script-free and refuses a malformed nonce", async () => {
    const port = createOfficePreviewPort({ scope: { document_id: "D1", job_id: "J1" }, proxy, allowVisualEdit: true });
    const plain = await port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>x</p>",
      manifest: { entries: [] },
    });
    expect(plain.iframe.getAttribute("sandbox")).toBe("");
    expect(plain.iframe.getAttribute("csp")).toContain("script-src 'none'");
    plain.dispose();
    await expect(port.mount({
      container: document.createElement("div"),
      format: "html",
      title: "HTML",
      text: "<p>x</p>",
      manifest: { entries: [] },
      visualEdit: { nonce: "nope" },
    })).rejects.toMatchObject({ name: "PreviewIsolationError" });
  });
});
