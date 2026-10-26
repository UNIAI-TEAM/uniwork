import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capabilityResult, docsPdfRendererMissing } from "./capability.ts";

type Row = { operation: string; supported: boolean; runtime: string; evidence_level: string; reason?: string };
const rows = (format: "page" | "docx" | "xlsx" | "pptx" | "pdf" | "md", missing: string | null) =>
  capabilityResult(format, 1024, missing).capabilities as Row[];

// follow-6: pdf is advertised only where the Docs renderer can run, so the
// web hides "Xuất PDF" instead of learning it from the first refusal.
describe("export_pdf capability row", () => {
  it("claims pdf for a page and a docx only when the renderer is staged", () => {
    for (const format of ["page", "docx"] as const) {
      expect(rows(format, null).find((r) => r.operation === "export_pdf")).toMatchObject({ supported: true, runtime: "internal_service" });
      expect(rows(format, "docs_pdf_assets_missing").find((r) => r.operation === "export_pdf")).toMatchObject({
        supported: false,
        runtime: "none",
        reason: "docs_pdf_assets_missing",
      });
    }
    expect(rows("md", null).some((r) => r.operation === "export_pdf")).toBe(false);
  });

  it("reads the renderer as missing without the dir, the bundle, the browser or the sandbox", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uw-docs-pdf-"));
    expect(docsPdfRendererMissing(undefined, true)).toBe("docs_pdf_assets_missing");
    expect(docsPdfRendererMissing(dir, true)).toBe("docs_pdf_assets_missing");
    await mkdir(join(dir, "bundle"));
    await writeFile(join(dir, "bundle", "index.html"), "<!doctype html>");
    expect(docsPdfRendererMissing(dir, true)).toBe("docs_pdf_assets_missing");
    await writeFile(join(dir, "chromium"), "#!/bin/sh\n");
    expect(docsPdfRendererMissing(dir, false)).toBe("sandbox_required");
    expect(docsPdfRendererMissing(dir, true)).toBeNull();
  });

  it("claims extract_text as proven for docx, xlsx and pptx and unsupported for other formats", () => {
    for (const format of ["docx", "xlsx", "pptx"] as const) {
      expect(rows(format, null).find((r) => r.operation === "extract_text")).toMatchObject({
        operation: "extract_text",
        supported: true,
        runtime: "internal_service",
        evidence_level: "proven",
      });
    }
    for (const format of ["pdf", "md", "page"] as const) {
      expect(rows(format, null).find((r) => r.operation === "extract_text")).toMatchObject({
        operation: "extract_text",
        supported: false,
        runtime: "none",
        evidence_level: "pending",
      });
    }
  });
});
