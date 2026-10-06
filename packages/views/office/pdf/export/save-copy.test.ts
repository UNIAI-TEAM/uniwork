import { describe, expect, it, vi } from "vitest";
import { savePdfCopy } from "./save-copy";
import { PdfExportError } from "./types";

describe("savePdfCopy", () => {
  it("downloads the host bytes under the copy filename and reports the name", async () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    const download = vi.fn(async () => undefined);

    const filename = await savePdfCopy({ output: { readOutputBytes: async () => bytes }, fileBaseName: "report", download });

    expect(download).toHaveBeenCalledWith(bytes, "report.pdf");
    expect(filename).toBe("report.pdf");
  });

  it("refuses empty host bytes", async () => {
    await expect(savePdfCopy({ output: { readOutputBytes: async () => new Uint8Array() }, download: vi.fn() })).rejects.toBeInstanceOf(PdfExportError);
  });

  it("propagates a host read failure without touching the download", async () => {
    const download = vi.fn();
    await expect(savePdfCopy({ output: { readOutputBytes: async () => { throw new Error("serialize failed"); } }, download })).rejects.toThrow("serialize failed");
    expect(download).not.toHaveBeenCalled();
  });
});
