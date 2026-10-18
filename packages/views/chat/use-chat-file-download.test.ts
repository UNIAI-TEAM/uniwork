import { describe, expect, it, vi } from "vitest";
import { formatChatFileProgress } from "./chat-file-size";
import { chatDownloadPercent, fetchChatFileBlob } from "./use-chat-file-download";

function streamed(chunks: number[], headers: Record<string, string> = {}): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("chat file download progress", () => {
  it("rounds and clamps the percent", () => {
    expect(chatDownloadPercent(0, 2_000)).toBe(0);
    expect(chatDownloadPercent(1_240, 2_000)).toBe(62);
    // A gzip-encoded body can outgrow its Content-Length.
    expect(chatDownloadPercent(3_000, 2_000)).toBe(100);
    expect(chatDownloadPercent(10, 0)).toBe(0);
  });

  it("writes what has arrived in the unit of the whole (canvas)", () => {
    expect(formatChatFileProgress(1.3 * 1024 * 1024, 2.1 * 1024 * 1024, "vi")).toBe("1,3 / 2,1 MB");
    expect(formatChatFileProgress(10 * 1024, 48 * 1024, "vi")).toBe("10 / 48 KB");
    expect(formatChatFileProgress(5_000, 100, "vi")).toBe("100 / 100 B");
  });

  it("reports every chunk against Content-Length and returns the whole file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed([300, 700], { "Content-Length": "1000" })));
    const seen: [number, number | null][] = [];
    const blob = await fetchChatFileBlob("https://storage.test/a", 5, new AbortController().signal, (loaded, total) =>
      seen.push([loaded, total]),
    );
    expect(seen).toEqual([
      [300, 1000],
      [1000, 1000],
    ]);
    expect(blob?.size).toBe(1000);
    vi.unstubAllGlobals();
  });

  it("falls back to the declared size, and to null when the browser cannot reach storage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamed([10])));
    const totals: (number | null)[] = [];
    await fetchChatFileBlob("https://storage.test/b", 10, new AbortController().signal, (_, total) => totals.push(total));
    expect(totals).toEqual([10]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchChatFileBlob("https://storage.test/c", 10, new AbortController().signal, () => {})).resolves.toBeNull();

    // A cancel is not a CORS failure: it must not fall back to a second download.
    const aborted = new AbortController();
    aborted.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    await expect(fetchChatFileBlob("https://storage.test/d", 10, aborted.signal, () => {})).rejects.toThrow("Aborted");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gone", { status: 403 })));
    await expect(fetchChatFileBlob("https://storage.test/e", 10, new AbortController().signal, () => {})).rejects.toThrow(
      "403",
    );
    vi.unstubAllGlobals();
  });
});
