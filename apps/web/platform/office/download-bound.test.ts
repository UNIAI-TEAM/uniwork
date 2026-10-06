import { beforeEach, describe, expect, it, vi } from "vitest";
import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import { isOfficeTooLarge } from "@uniwork/core/office";

const meta = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/endpoints/documents", () => ({ getDocumentDownloadMeta: meta, downloadDocumentFile: download }));

import { readDocumentBytesWithinBound } from "./download-bound";

const withSize = (size_bytes: number) => ({ document_id: "d", file: { size_bytes } });

describe("readDocumentBytesWithinBound", () => {
  beforeEach(() => {
    meta.mockReset();
    download.mockReset();
    download.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2]).buffer });
  });

  it("fails as too large without starting the download when the size is past the bound", async () => {
    meta.mockResolvedValue(withSize(ENGINE_LIMITS.max_input_bytes + 1));
    const error = await readDocumentBytesWithinBound("d").catch((e: unknown) => e);
    expect(isOfficeTooLarge(error as { kind?: string })).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads at the bound", async () => {
    meta.mockResolvedValue(withSize(ENGINE_LIMITS.max_input_bytes));
    expect([...(await readDocumentBytesWithinBound("d", 3))]).toEqual([1, 2]);
    expect(download).toHaveBeenCalledWith("d", 3);
  });

  it("downloads when the descriptor is missing or fails", async () => {
    meta.mockResolvedValueOnce(null);
    await readDocumentBytesWithinBound("d");
    meta.mockRejectedValueOnce(new Error("boom"));
    await readDocumentBytesWithinBound("d");
    expect(download).toHaveBeenCalledTimes(2);
  });
});
