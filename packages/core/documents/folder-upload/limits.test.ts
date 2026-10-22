import { describe, expect, it } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from "../../api/endpoints/config";
import { folderUploadLimits } from "./limits";

const block = {
  max_files: 500,
  max_folders: 400,
  max_total_bytes: 2147483648,
  max_depth: 20,
  parallel: 4,
  complete_batch: 50,
};

function withBlock(folderUpload: DocumentLimits["folder_upload"]): DocumentLimits {
  return { ...DEFAULT_DOCUMENT_LIMITS, upload_max_bytes: 1234, folder_upload: folderUpload };
}

describe("folderUploadLimits", () => {
  it("is null when the server does not advertise folder uploads", () => {
    expect(folderUploadLimits(DEFAULT_DOCUMENT_LIMITS)).toBeNull();
  });

  it("maps the config block onto planner limits and runner knobs", () => {
    expect(folderUploadLimits(withBlock(block))).toEqual({
      maxFiles: 500,
      maxFolders: 400,
      maxTotalBytes: 2147483648,
      maxDepth: 20,
      perFileMaxBytes: 1234,
      parallel: 4,
      completeBatch: 50,
    });
  });

  it("clamps parallel to [1, 6] and completeBatch to [1, 50]", () => {
    const high = folderUploadLimits(withBlock({ ...block, parallel: 40, complete_batch: 400 }));
    expect(high).toMatchObject({ parallel: 6, completeBatch: 50 });
    const low = folderUploadLimits(withBlock({ ...block, parallel: 0, complete_batch: -3 }));
    expect(low).toMatchObject({ parallel: 1, completeBatch: 1 });
  });

  it("carries the server's extension list for the planner", () => {
    const limits = { ...withBlock(block), upload_extensions: ["pdf", "docx"] };
    expect(folderUploadLimits(limits)?.uploadExtensions).toEqual(["pdf", "docx"]);
    expect(folderUploadLimits(withBlock(block))).not.toHaveProperty("uploadExtensions");
  });

  it("carries the chunked threshold so the runner knows which files need a probe", () => {
    const limits = { ...withBlock(block), chunked_upload_threshold_bytes: 20 };
    expect(folderUploadLimits(limits)?.chunkedThresholdBytes).toBe(20);
    expect(folderUploadLimits(withBlock(block))).not.toHaveProperty("chunkedThresholdBytes");
  });
});
