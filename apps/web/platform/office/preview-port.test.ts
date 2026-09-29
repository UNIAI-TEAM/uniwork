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
});
