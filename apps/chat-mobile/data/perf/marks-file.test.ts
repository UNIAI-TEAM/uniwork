import { afterEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({ written: new Map<string, string>(), fail: false as false | "error" | "native" }));
vi.mock("expo-file-system", () => ({
  Paths: { document: { uri: "file:///docs" } },
  File: class {
    readonly uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    write(text: string) {
      if (fs.fail) throw fs.fail === "native" ? "disk full" : new Error("disk full");
      fs.written.set(this.uri, text);
    }
  },
}));

import { PERF_MARKS_FILE, writePerfMarks } from "./marks-file";

afterEach(() => {
  fs.written.clear();
  fs.fail = false;
  vi.restoreAllMocks();
});

describe("writePerfMarks", () => {
  it("rewrites the marks file in the app's documents", () => {
    writePerfMarks("UniChatPerf mark=js-boot at=1");
    writePerfMarks("UniChatPerf mark=js-boot at=1\nUniChatPerf mark=first-screen at=2");
    expect(fs.written.get(`file:///docs/${PERF_MARKS_FILE}`)).toBe("UniChatPerf mark=js-boot at=1\nUniChatPerf mark=first-screen at=2");
  });

  it("logs a write that fails instead of throwing into the boot", () => {
    fs.fail = "error";
    expect(() => writePerfMarks("x")).not.toThrow();
    // A native module may reject with a bare string: still logged, still not thrown.
    fs.fail = "native";
    expect(() => writePerfMarks("x")).not.toThrow();
    expect(fs.written.size).toBe(0);
  });
});
