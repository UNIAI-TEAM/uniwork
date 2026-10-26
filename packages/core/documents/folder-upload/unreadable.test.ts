import { describe, expect, it, vi } from "vitest";
import { findUnreadable, type UnreadableCandidate } from "./unreadable";

// Chromium reports size 0 for a path past MAX_PATH, and reading it rejects.
class UnstatableBlob extends Blob {
  override get size(): number {
    return 0;
  }
  override arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.reject(new DOMException("not found", "NotFoundError"));
  }
}

const unreadable = (path: string): UnreadableCandidate => ({ path, file: new UnstatableBlob(["x"]) });
const readable = (path: string, body = "x"): UnreadableCandidate => ({ path, file: new Blob([body]) });

describe("findUnreadable", () => {
  it("does not report a readable empty file", async () => {
    expect(await findUnreadable([readable("R/empty.txt", "")])).toEqual([]);
  });

  it("reports a size-0 file the browser cannot open, in input order", async () => {
    const found = await findUnreadable([
      readable("R/a.pdf"),
      unreadable("R/deep/b.pdf"),
      readable("R/empty.txt", ""),
      unreadable("R/c.pdf"),
    ]);
    expect(found).toEqual(["R/deep/b.pdf", "R/c.pdf"]);
  });

  it("never reads a file that has bytes", async () => {
    const file = new Blob(["hello"]);
    const read = vi.spyOn(file, "arrayBuffer");
    const slice = vi.spyOn(file, "slice");
    expect(await findUnreadable([{ path: "R/a.pdf", file }])).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
  });

  it("probes at most 16 files at once and still keeps the order", async () => {
    let inFlight = 0;
    let peak = 0;
    class SlowBlob extends Blob {
      override get size(): number {
        return 0;
      }
      override async arrayBuffer(): Promise<ArrayBuffer> {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        throw new DOMException("not found", "NotFoundError");
      }
    }
    const candidates = Array.from({ length: 50 }, (_, i) => ({ path: `R/f${String(i).padStart(2, "0")}.pdf`, file: new SlowBlob(["x"]) }));
    const found = await findUnreadable(candidates);
    expect(found).toEqual(candidates.map((c) => c.path));
    expect(peak).toBe(16);
  });

  it("stops with an AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = findUnreadable([unreadable("R/a.pdf"), unreadable("R/b.pdf")], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("resolves an empty list at once", async () => {
    expect(await findUnreadable([])).toEqual([]);
  });
});
