import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS } from "../../api/endpoints/config";
import {
  buildUploadProbe,
  ChunkedUploadError,
  chunkedUploadThreshold,
} from "./index";

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeBase64(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Builds a valid stored (method 0) ZIP archive in memory with the given entries
 * and returns its Blob plus the exact byte offset and size of its central
 * directory + EOCD tail.
 */
function buildTestZip(
  entries: { name: string; content: Uint8Array }[],
  opts?: {
    extraCentralDirPaddingBytes?: number;
    comment?: Uint8Array;
    zip64?: boolean;
  },
): { blob: Blob; cdOffset: number; cdSize: number; totalSize: number } {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const data = entry.content;
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // PK\x03\x04
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // store
    lv.setUint32(14, 0, true); // crc32 (unused by central dir structure check)
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra len
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // PK\x01\x02
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // store
    cv.setUint32(20, data.length, true); // compressed
    cv.setUint32(24, data.length, true); // uncompressed
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const cdOffset = offset;
  if (opts?.extraCentralDirPaddingBytes) {
    centralParts.push(new Uint8Array(opts.extraCentralDirPaddingBytes));
  }
  const cdOnlyBytes = centralParts.reduce((acc, p) => acc + p.length, 0);

  const tailParts: Uint8Array[] = [];
  if (opts?.zip64) {
    const zip64EocdOffset = cdOffset + cdOnlyBytes;
    const z64Eocd = new Uint8Array(56);
    const zv = new DataView(z64Eocd.buffer);
    zv.setUint32(0, 0x06064b50, true); // PK\x06\x06
    zv.setBigUint64(4, 44n, true); // remaining size
    zv.setUint16(12, 45, true);
    zv.setUint16(14, 45, true);
    zv.setBigUint64(24, BigInt(entries.length), true);
    zv.setBigUint64(32, BigInt(entries.length), true);
    zv.setBigUint64(40, BigInt(cdOnlyBytes), true);
    zv.setBigUint64(48, BigInt(cdOffset), true);

    const z64Loc = new Uint8Array(20);
    const lv = new DataView(z64Loc.buffer);
    lv.setUint32(0, 0x07064b50, true); // PK\x06\x07
    lv.setUint32(4, 0, true);
    lv.setBigUint64(8, BigInt(zip64EocdOffset), true);
    lv.setUint32(16, 1, true);

    tailParts.push(z64Eocd, z64Loc);
  }

  const commentBytes = opts?.comment ?? new Uint8Array(0);
  const eocd = new Uint8Array(22 + commentBytes.byteLength);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // PK\x05\x06
  ev.setUint16(8, opts?.zip64 ? 0xffff : entries.length, true);
  ev.setUint16(10, opts?.zip64 ? 0xffff : entries.length, true);
  ev.setUint32(12, opts?.zip64 ? 0xffffffff : cdOnlyBytes, true);
  ev.setUint32(16, opts?.zip64 ? 0xffffffff : cdOffset, true);
  ev.setUint16(20, commentBytes.byteLength, true); // comment length
  if (commentBytes.byteLength > 0) {
    eocd.set(commentBytes, 22);
  }
  tailParts.push(eocd);

  const tailBytes = tailParts.reduce((acc, p) => acc + p.length, 0);
  const cdSize = cdOnlyBytes + tailBytes;
  const blob = new Blob([...localParts, ...centralParts, ...tailParts] as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  return { blob, cdOffset, cdSize, totalSize: cdOffset + cdSize };
}

describe("buildUploadProbe and chunkedUploadThreshold", () => {
  it("extracts head <= 64 KiB, locates EOCD, and matches cd_offset/cd_size on a real docx zip", async () => {
    const bodyPadding = new Uint8Array(70_000);
    bodyPadding.fill(0x41);
    const { blob, cdOffset, cdSize } = buildTestZip([
      { name: "[Content_Types].xml", content: encodeUtf8("<Types/>") },
      { name: "word/document.xml", content: bodyPadding },
    ]);

    const probe = await buildUploadProbe(blob);
    const headBytes = decodeBase64(probe.head_b64);
    const cdBytes = decodeBase64(probe.central_dir_b64);

    expect(headBytes.byteLength).toBe(65536);
    expect(Array.from(headBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(probe.cd_offset).toBe(cdOffset);
    expect(probe.cd_size).toBe(cdSize);
    expect(cdBytes.byteLength).toBe(cdSize);
    // Starts with Central Directory File Header PK\x01\x02 and ends with EOCD PK\x05\x06
    expect(Array.from(cdBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x01, 0x02]);
    expect(Array.from(cdBytes.slice(cdBytes.length - 22, cdBytes.length - 18))).toEqual([
      0x50, 0x4b, 0x05, 0x06,
    ]);
  });

  it("extracts cd_offset and cd_size from a ZIP64 archive (locator + ZIP64 EOCD record)", async () => {
    const { blob, cdOffset, cdSize } = buildTestZip(
      [
        { name: "[Content_Types].xml", content: encodeUtf8("<Types/>") },
        { name: "xl/workbook.xml", content: encodeUtf8("<workbook/>") },
      ],
      { zip64: true },
    );

    const probe = await buildUploadProbe(blob);
    const cdBytes = decodeBase64(probe.central_dir_b64);

    expect(probe.cd_offset).toBe(cdOffset);
    expect(probe.cd_size).toBe(cdSize);
    expect(cdBytes.byteLength).toBe(cdSize);
    expect(Array.from(cdBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x01, 0x02]);
  });

  it("locates EOCD when a trailing archive comment is present (including embedded PK\\x05\\x06 bytes in the comment)", async () => {
    // Include a fake PK\x05\x06 inside the comment to verify comment-length matching picks the true EOCD.
    const comment = new Uint8Array([
      0x63, 0x6f, 0x6d, 0x6d, 0x65, 0x6e, 0x74, 0x3a, 0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x21, 0x21,
    ]);
    const { blob, cdOffset, cdSize } = buildTestZip(
      [
        { name: "[Content_Types].xml", content: encodeUtf8("<Types/>") },
        { name: "ppt/presentation.xml", content: encodeUtf8("<p:presentation/>") },
      ],
      { comment },
    );

    const probe = await buildUploadProbe(blob);
    const cdBytes = decodeBase64(probe.central_dir_b64);

    expect(probe.cd_offset).toBe(cdOffset);
    expect(probe.cd_size).toBe(cdSize);
    expect(cdBytes.byteLength).toBe(cdSize);
    expect(Array.from(cdBytes.slice(cdBytes.length - comment.length))).toEqual(Array.from(comment));
  });

  it("reads only the 64 KiB head slice and returns zero cd_offset/cd_size for a > 20 MiB non-zip PDF/image", async () => {
    const header = encodeUtf8("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
    const largeSize = 21 * 1024 * 1024;
    const headChunk = new Uint8Array(65_536);
    headChunk.set(header, 0);
    const pdfBlob = new Blob([headChunk, new Uint8Array(largeSize - headChunk.byteLength)], {
      type: "application/pdf",
    });
    const sliceSpy = vi.spyOn(pdfBlob, "slice");

    const probe = await buildUploadProbe(pdfBlob);
    expect(sliceSpy).toHaveBeenCalledTimes(1);
    expect(sliceSpy).toHaveBeenCalledWith(0, 65_536);

    const headBytes = decodeBase64(probe.head_b64);
    expect(headBytes.byteLength).toBe(65_536);
    expect(new TextDecoder().decode(headBytes.slice(0, header.byteLength))).toBe(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n",
    );
    expect(probe.central_dir_b64).toBe("");
    expect(probe.cd_offset).toBe(0);
    expect(probe.cd_size).toBe(0);
  });

  it("returns empty central_dir_b64 and zero cd_offset/cd_size for a non-zip file", async () => {
    const pdfBlob = new Blob(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"], {
      type: "application/pdf",
    });
    const probe = await buildUploadProbe(pdfBlob);
    const headBytes = decodeBase64(probe.head_b64);
    expect(new TextDecoder().decode(headBytes)).toContain("%PDF-1.7");
    expect(probe.central_dir_b64).toBe("");
    expect(probe.cd_offset).toBe(0);
    expect(probe.cd_size).toBe(0);
  });

  it("rejects with ChunkedUploadError(central_directory_too_large) when central directory exceeds 1 MiB", async () => {
    const { blob } = buildTestZip(
      [
        { name: "[Content_Types].xml", content: encodeUtf8("<Types/>") },
        { name: "word/document.xml", content: encodeUtf8("<w:document/>") },
      ],
      { extraCentralDirPaddingBytes: 1024 * 1024 + 16 },
    );

    const err = await buildUploadProbe(blob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChunkedUploadError);
    expect(err).toMatchObject({
      name: "ChunkedUploadError",
      code: "central_directory_too_large",
    });
  });

  it("reads chunked_upload_threshold_bytes from PublicConfig or DocumentLimits and returns null when absent", () => {
    expect(chunkedUploadThreshold(null)).toBeNull();
    expect(chunkedUploadThreshold(undefined)).toBeNull();
    expect(chunkedUploadThreshold({ documents: { limits: DEFAULT_DOCUMENT_LIMITS } })).toBeNull();
    expect(chunkedUploadThreshold(DEFAULT_DOCUMENT_LIMITS)).toBeNull();
    expect(
      chunkedUploadThreshold({
        documents: {
          limits: { ...DEFAULT_DOCUMENT_LIMITS, chunked_upload_threshold_bytes: 20_971_520 },
        },
      }),
    ).toBe(20_971_520);
    expect(
      chunkedUploadThreshold({
        ...DEFAULT_DOCUMENT_LIMITS,
        chunked_upload_threshold_bytes: 20_971_520,
      }),
    ).toBe(20_971_520);
  });
});

