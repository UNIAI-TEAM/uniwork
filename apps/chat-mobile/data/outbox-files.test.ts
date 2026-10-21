import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory filesystem behind expo-file-system's File / Directory surface.
// A fail flag set to "native" throws a non-Error, as a native module may.
const fs = vi.hoisted(() => ({ paths: new Set<string>(), failCopy: false as boolean | "native", failDelete: false as boolean | "native" }));
vi.mock("expo-file-system", () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri)).join("/");
  class Directory {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return [...fs.paths].some((p) => p === this.uri || p.startsWith(`${this.uri}/`));
    }
    create() {
      fs.paths.add(this.uri);
    }
    delete() {
      if (fs.failDelete) throw fs.failDelete === "native" ? "busy" : new Error("busy");
      for (const p of [...fs.paths]) if (p === this.uri || p.startsWith(`${this.uri}/`)) fs.paths.delete(p);
    }
  }
  class File {
    readonly uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    async copy(target: File) {
      if (fs.failCopy) throw fs.failCopy === "native" ? "gone" : new Error("gone");
      fs.paths.add(target.uri);
    }
  }
  return { Directory, File, Paths: { document: { uri: "file:///docs" } } };
});

import { installReportSink } from "./report";
import { outboxFileName, outboxFiles } from "./outbox-files";

beforeEach(() => {
  fs.paths.clear();
  fs.failCopy = false;
  fs.failDelete = false;
});

describe("outbox files", () => {
  it("copies a picked file under documents/outbox/<clientMsgId>/ and deletes it once released", async () => {
    const kept = await outboxFiles.keep("c1", { uri: "file:///cache/IMG_1.png", name: "IMG 1.png", mimeType: "image/png", size: 3 });
    expect(kept).toEqual({ uri: "file:///docs/outbox/c1/IMG 1.png", name: "IMG 1.png", mimeType: "image/png", size: 3 });
    await outboxFiles.keep("c2", { uri: "file:///cache/b", name: "b" });
    outboxFiles.release("c1");
    expect([...fs.paths].some((p) => p.includes("/c1"))).toBe(false);
    expect([...fs.paths].some((p) => p.includes("/c2"))).toBe(true);
    outboxFiles.release("missing");
    outboxFiles.releaseAll();
    expect(fs.paths.size).toBe(0);
  });

  it("a copy or a delete that fails never stops the send: the picked file is used, the failure logged", async () => {
    const warnings: string[] = [];
    installReportSink({ captureException: vi.fn(), addBreadcrumb: (b) => void warnings.push(b.message ?? ""), setUser: vi.fn(), setTag: vi.fn() });
    try {
      fs.failCopy = true;
      const file = { uri: "file:///cache/a", name: "a" };
      expect(await outboxFiles.keep("c1", file)).toBe(file);
      fs.failCopy = "native";
      expect(await outboxFiles.keep("c1", file)).toBe(file);
      fs.paths.add("file:///docs/outbox/c1");
      fs.failDelete = true;
      outboxFiles.release("c1");
      fs.failDelete = "native";
      outboxFiles.release("c1");
      expect(warnings).toEqual([
        "outbox copy failed, sending from the picked file",
        "outbox copy failed, sending from the picked file",
        "outbox copy not deleted",
        "outbox copy not deleted",
      ]);
    } finally {
      installReportSink(null);
    }
  });

  it("names a copy so the directory can hold it", () => {
    expect(outboxFileName("a/b\\c.png")).toBe("a_b_c.png");
    expect(outboxFileName("..hidden")).toBe("hidden");
    expect(outboxFileName("  ")).toBe("file");
  });
});
