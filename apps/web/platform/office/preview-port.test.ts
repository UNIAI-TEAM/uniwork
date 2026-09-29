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
});
