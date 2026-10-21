import { describe, expect, it } from "vitest";
import vectors from "./folder-upload-vectors.json";
import { planFolderUpload, uniqueRootName } from "./plan";
import type { FolderUploadEntry, FolderUploadLimits, FolderUploadPlan } from "./types";

interface Vector {
  name: string;
  input: { entries: FolderUploadEntry[]; limits: FolderUploadLimits; parentLevel: number; siblingNames: string[] };
  expected: FolderUploadPlan;
}

const LIMITS: FolderUploadLimits = {
  maxFiles: 500,
  maxTotalBytes: 2 * 1024 ** 3,
  maxDepth: 20,
  perFileMaxBytes: 200 * 1024 * 1024,
};

describe("planFolderUpload vectors (shared with the desktop app)", () => {
  it("covers every rule at least once", () => {
    const names = (vectors as Vector[]).map((v) => v.name).join("\n");
    for (const rule of [
      "hidden", "unsupported_format", "per-file cap", "500 characters", "invalid_path", "NFC", "not created",
      "ordered top-down", "too_many_files", "too_large_total", "too_deep", "nothing_to_upload", "segment_too_long",
      "multiple_roots", "clash",
    ]) {
      expect(names).toContain(rule);
    }
  });

  it.each(vectors as Vector[])("$name", ({ input, expected }) => {
    expect(planFolderUpload(input.entries, input)).toEqual(expected);
  });
});

describe("planFolderUpload", () => {
  const opts = { limits: LIMITS, parentLevel: 1, siblingNames: [] as string[] };

  it("maps files back to their input position, skipped entries included", () => {
    const plan = planFolderUpload(
      [{ path: "R/.DS_Store", size: 1 }, { path: "R/a.pdf", size: 2 }, { path: "R/x.exe", size: 3 }, { path: "R/b.pdf", size: 4 }],
      opts,
    );
    expect(plan.files.map((f) => f.index)).toEqual([1, 3]);
  });

  it("never reads the optional file handle", () => {
    const entry: FolderUploadEntry<{ name: string }> = { path: "R/a.pdf", size: 1, file: { name: "other.pdf" } };
    expect(planFolderUpload([entry], opts).files[0]?.filename).toBe("a.pdf");
  });

  it("keeps the same folder list whatever the input order", () => {
    const a = planFolderUpload([{ path: "R/x/1.pdf", size: 1 }, { path: "R/y/2.pdf", size: 1 }], opts);
    const b = planFolderUpload([{ path: "R/y/2.pdf", size: 1 }, { path: "R/x/1.pdf", size: 1 }], opts);
    expect(b.folders).toEqual(a.folders);
  });

  it("names a hidden-only folder so the dialog can say what was dropped", () => {
    const plan = planFolderUpload([{ path: "Photos/.DS_Store", size: 1 }], opts);
    expect(plan.rootName).toBe("Photos");
    expect(plan.refusal).toEqual({ code: "nothing_to_upload" });
  });

  it("checks refusals in a fixed order: depth before count before bytes", () => {
    const plan = planFolderUpload(
      [{ path: "R/a/a.pdf", size: 10 }, { path: "R/b.pdf", size: 10 }],
      { limits: { ...LIMITS, maxDepth: 2, maxFiles: 1, maxTotalBytes: 5 }, parentLevel: 0, siblingNames: [] },
    );
    expect(plan.refusal?.code).toBe("too_deep");
  });
});

describe("uniqueRootName", () => {
  it("returns the normalised name when nothing clashes", () => {
    expect(uniqueRootName(" Báo ", ["Other"])).toBe("Báo");
  });

  it("picks the smallest free number", () => {
    expect(uniqueRootName("A", ["a", "A (1)", "a (2)", "A (4)"])).toBe("A (3)");
  });

  it("does not treat a different name as a clash", () => {
    expect(uniqueRootName("A", ["A (1)", "AB"])).toBe("A");
  });
});
