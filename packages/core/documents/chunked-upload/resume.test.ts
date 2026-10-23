import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "../../types/storage";
import {
  clearResumableUpload,
  findResumableUpload,
  saveResumableUpload,
  uploadFileKey,
  uploadSessionStorageKey,
  uploadTargetKey,
} from "./index";

function createFakeStorage(): StorageAdapter & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => map,
  };
}

describe("chunked upload resume storage", () => {
  const target = { kind: "workspace" as const, workspaceId: "ws-1", parentId: "folder-1" };

  it("computes uploadFileKey as ${name}:${size}:${lastModified}", () => {
    const file = new File(["hello world"], "Report.docx", { lastModified: 1760700000000 });
    expect(uploadFileKey(file)).toBe("Report.docx:11:1760700000000");
    expect(uploadTargetKey(target)).toBe("workspace:ws-1:folder-1");
    expect(uploadTargetKey({ kind: "version", documentId: "doc-1" })).toBe("version:doc-1");
    expect(uploadTargetKey({ kind: "frame", documentId: "doc-1", frameToken: "tok" })).toBe(
      "frame:doc-1",
    );
    expect(uploadSessionStorageKey("Report.docx:11:1760700000000", target)).toBe(
      "uniwork:upload-session:Report.docx:11:1760700000000:workspace:ws-1:folder-1",
    );
  });

  it("writes, reads, and clears a resumable upload record through StorageAdapter", () => {
    const storage = createFakeStorage();
    const fileKey = "Report.docx:25165824:1760700000000";
    const record = {
      session_id: "sess-1",
      expires_at: "2026-10-18T12:00:00Z",
      idempotency_key: "idem-1",
    };

    expect(findResumableUpload(storage, fileKey, target, Date.parse("2026-10-17T12:00:00Z"))).toBeNull();

    saveResumableUpload(storage, fileKey, target, record);
    expect(findResumableUpload(storage, fileKey, target, Date.parse("2026-10-17T12:00:00Z"))).toEqual(
      record,
    );

    clearResumableUpload(storage, fileKey, target);
    expect(findResumableUpload(storage, fileKey, target, Date.parse("2026-10-17T12:00:00Z"))).toBeNull();
    expect(storage.dump().size).toBe(0);
  });

  it("evicts expired or malformed resume records on read", () => {
    const storage = createFakeStorage();
    const fileKey = "Report.docx:25165824:1760700000000";
    const record = {
      session_id: "sess-expired",
      expires_at: "2026-10-17T10:00:00Z",
      idempotency_key: "idem-expired",
    };

    saveResumableUpload(storage, fileKey, target, record);
    expect(storage.dump().size).toBe(1);
    expect(findResumableUpload(storage, fileKey, target, Date.parse("2026-10-17T10:00:01Z"))).toBeNull();
    expect(storage.dump().size).toBe(0);

    // Malformed JSON is also evicted cleanly.
    const rawKey = uploadSessionStorageKey(fileKey, target);
    storage.setItem(rawKey, "{not-json");
    expect(findResumableUpload(storage, fileKey, target, Date.parse("2026-10-17T09:00:00Z"))).toBeNull();
    expect(storage.getItem(rawKey)).toBeNull();
  });
});
