import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { createPptxCommandMap, findPptxCommand } from "../command-map";
import { PptxToolbar } from "../toolbar";
import { createPptxPrintPort, pptxPrintCapability, type PptxPrintFrame } from "./pptx-export-pdf";
import type { PptxPrintSlide } from "./pptx-print";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const slides: readonly PptxPrintSlide[] = [{ markup: "<svg viewBox=\"0 0 1280 720\"></svg>", widthPx: 1280, heightPx: 720 }];

/** A frame stand-in that records the write/print/remove calls, so the browser path is
 *  asserted without a real window or a real print dialog. */
function recordingFrame(): { frame: PptxPrintFrame; written: string[]; printed: () => number; removed: () => number } {
  const written: string[] = [];
  let printed = 0;
  let removed = 0;
  const frame: PptxPrintFrame = {
    write: (html) => { written.push(html); },
    print: () => { printed += 1; },
    remove: () => { removed += 1; },
  };
  return { frame, written, printed: () => printed, removed: () => removed };
}

describe("pptx export-pdf command -> print port", () => {
  it("marks export-pdf available when a port is supplied and unavailable without one", () => {
    const port = createPptxPrintPort({ document, createFrame: () => recordingFrame().frame });
    const withPort = createPptxCommandMap({ host: null, capabilities: { "export-pdf": pptxPrintCapability(port) } });
    expect(findPptxCommand(withPort, "export-pdf")?.capability.status).toBe("available");
    const without = createPptxCommandMap({ host: null });
    expect(findPptxCommand(without, "export-pdf")?.capability.status).toBe("unavailable");
    expect(pptxPrintCapability(null).reason).toBe("PPTX PDF export is not bound in the browser build");
  });

  it("writes the print document and calls print() when the ribbon command fires", async () => {
    const rec = recordingFrame();
    const port = createPptxPrintPort({ document: document, createFrame: () => rec.frame, readyDelayMs: 0 });
    // The exact 3-line wiring the serialized wire pass adds to pptx-editor.tsx:
    //   capabilities["export-pdf"] = pptxPrintCapability(printPort)
    //   case "export-pdf": if (printPort) runCommand(printPort.print({ slides, title })); break
    const commands = createPptxCommandMap({ host: null, capabilities: { "export-pdf": pptxPrintCapability(port) } });
    const onCommand = vi.fn((id) => {
      if (id === "export-pdf") void port.print({ slides, title: "Deck" });
    });
    render(<PptxToolbar commands={commands} onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    expect(onCommand).toHaveBeenCalledWith("export-pdf");
    await waitFor(() => expect(rec.printed()).toBe(1));
    expect(rec.written[0]).toContain("<title>Deck</title>");
    expect(rec.removed()).toBe(1);
  });

  it("reports a failed host write instead of trying a second path (X4fix F2)", async () => {
    const rec = recordingFrame();
    const pdfSave = vi.fn(async () => { throw new Error("disk full"); });
    const port = createPptxPrintPort({ pdfSave, document: document, createFrame: () => rec.frame });
    expect(port.mode).toBe("host");
    const result = await port.print({ slides, title: "Deck", fileName: "deck.pdf" });
    expect(pdfSave).toHaveBeenCalledWith(expect.objectContaining({ fileName: "deck.pdf", title: "Deck" }));
    expect(result).toEqual({ outcome: "failed", reason: "disk full" });
    expect(rec.printed()).toBe(0);
  });

  it("uses the bound host write when the host answers ok, and never the browser frame", async () => {
    const rec = recordingFrame();
    const pdfSave = vi.fn(async () => ({ ok: true, path: "C:/tmp/deck.pdf" }));
    const port = createPptxPrintPort({ pdfSave, document: document, createFrame: () => rec.frame });
    await expect(port.print({ slides, title: "Deck" })).resolves.toMatchObject({ outcome: "printed", mode: "host", path: "C:/tmp/deck.pdf" });
    expect(rec.printed()).toBe(0);
  });

  it("is a browser port with no host write bound: the mode says so and the run prints in the frame", async () => {
    const rec = recordingFrame();
    const port = createPptxPrintPort({ document: document, createFrame: () => rec.frame });
    expect(port.mode).toBe("browser");
    await expect(port.print({ slides })).resolves.toEqual({ outcome: "printed", mode: "browser" });
    expect(rec.printed()).toBe(1);
  });

  it("reports failure instead of a silent no-op when no print surface is bound", async () => {
    const port = createPptxPrintPort({ document: null });
    expect(port.available).toBe(false);
    await expect(port.print({ slides })).resolves.toMatchObject({ outcome: "failed" });
  });
});

