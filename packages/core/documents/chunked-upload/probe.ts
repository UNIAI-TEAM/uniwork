export type ChunkedUploadErrorCode =
  | "central_directory_too_large"
  | "missing_etag"
  | "upload_canceled"
  | "malformed_response";

export class ChunkedUploadError extends Error {
  constructor(
    public readonly code: ChunkedUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChunkedUploadError";
  }
}

export interface UploadProbe {
  head_b64: string;
  central_dir_b64: string;
  cd_offset: number;
  cd_size: number;
}

const HEAD_MAX_BYTES = 65_536;
const EOCD_SEARCH_MAX_BYTES = 65_577; // 65535 comment + 22 EOCD + 20 ZIP64 locator
const MAX_CENTRAL_DIR_BYTES = 1024 * 1024; // 1 MiB
const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50; // PK\x06\x07
const ZIP64_EOCD_SIGNATURE = 0x06064b50; // PK\x06\x06

function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  const chunkSize = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

async function readBlobSlice(file: Blob, start: number, end: number): Promise<Uint8Array> {
  const slice = file.slice(start, end);
  if (typeof slice.arrayBuffer === "function") {
    const ab = await slice.arrayBuffer();
    return new Uint8Array(ab);
  }
  for (const sym of Object.getOwnPropertySymbols(slice)) {
    const impl = (
      slice as unknown as Record<
        symbol,
        { _buffer?: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number } }
      >
    )[sym];
    const buf = impl?._buffer;
    if (buf && typeof buf.byteLength === "number" && typeof buf.byteOffset === "number") {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
  }
  if (typeof FileReader !== "undefined") {
    return new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error("Failed to read Blob slice"));
      };
      reader.readAsArrayBuffer(slice);
    });
  }
  const ab = await new Response(slice).arrayBuffer();
  return new Uint8Array(ab);
}

function isZipLocalHeader(head: Uint8Array): boolean {
  return (
    head.byteLength >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  );
}

function findEocdOffsetInTail(tail: Uint8Array): number {
  if (tail.byteLength < 22) return -1;
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let fallback = -1;
  for (let i = tail.byteLength - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === tail.byteLength) {
        return i;
      }
      if (fallback === -1) {
        fallback = i;
      }
    }
  }
  return fallback;
}

/** Reads ≤ 64 KiB head and the zip tail (EOCD, ZIP64 locator/record, central directory ≤ 1 MiB) with Blob.slice. Non-zip → empty central_dir_b64, cd_offset 0, cd_size 0. */
export async function buildUploadProbe(file: Blob): Promise<UploadProbe> {
  const headLen = Math.min(file.size, HEAD_MAX_BYTES);
  const headBytes = await readBlobSlice(file, 0, headLen);
  const head_b64 = bytesToBase64(headBytes);

  if (!isZipLocalHeader(headBytes)) {
    return {
      head_b64,
      central_dir_b64: "",
      cd_offset: 0,
      cd_size: 0,
    };
  }

  const tailLen = Math.min(file.size, EOCD_SEARCH_MAX_BYTES);
  const tailStart = file.size - tailLen;
  const tailBytes = await readBlobSlice(file, tailStart, file.size);
  const eocdPos = findEocdOffsetInTail(tailBytes);

  if (eocdPos < 0) {
    return {
      head_b64,
      central_dir_b64: "",
      cd_offset: 0,
      cd_size: 0,
    };
  }

  const tailView = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength);
  let cdSize = tailView.getUint32(eocdPos + 12, true);
  let cdOffset = tailView.getUint32(eocdPos + 16, true);

  if ((cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocdPos >= 20) {
    const locPos = eocdPos - 20;
    if (tailView.getUint32(locPos, true) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64EocdOffset = Number(tailView.getBigUint64(locPos + 8, true));
      if (zip64EocdOffset >= 0 && zip64EocdOffset + 56 <= file.size) {
        const z64Bytes = await readBlobSlice(file, zip64EocdOffset, zip64EocdOffset + 56);
        if (z64Bytes.byteLength >= 56) {
          const z64View = new DataView(z64Bytes.buffer, z64Bytes.byteOffset, z64Bytes.byteLength);
          if (z64View.getUint32(0, true) === ZIP64_EOCD_SIGNATURE) {
            cdSize = Number(z64View.getBigUint64(40, true));
            cdOffset = Number(z64View.getBigUint64(48, true));
          }
        }
      }
    }
  }

  const totalTailSliceSize = file.size - cdOffset;
  if (cdSize > MAX_CENTRAL_DIR_BYTES || totalTailSliceSize > MAX_CENTRAL_DIR_BYTES) {
    throw new ChunkedUploadError(
      "central_directory_too_large",
      "ZIP central directory exceeds 1 MiB",
    );
  }
  if (cdOffset < 0 || cdOffset > file.size || totalTailSliceSize <= 0) {
    return {
      head_b64,
      central_dir_b64: "",
      cd_offset: 0,
      cd_size: 0,
    };
  }

  const cdBytes = await readBlobSlice(file, cdOffset, file.size);
  return {
    head_b64,
    central_dir_b64: bytesToBase64(cdBytes),
    cd_offset: cdOffset,
    cd_size: cdBytes.byteLength,
  };
}
