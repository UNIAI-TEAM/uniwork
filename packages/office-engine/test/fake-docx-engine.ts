// Fake DOCX engine for adapter tests — a deterministic JSON convention that
// exercises the seam without the vendored engine.
//
// Conventions (mirroring upstream error shapes the adapter maps):
//   bytes   = UTF-8 JSON {magic:"fake-docx", blocks, extras?, hf?, parts}
//   parse   = decode + assign docxIndex to body blocks in order; throws
//             'not a docx: missing word/document.xml' when magic is absent
//   save    = rebuilds bytes from the plan: originals keep their block,
//             generated/xml/image/chart entries become real blocks; hidden
//             blocks are appended automatically. Deterministic — an
//             all-original plan re-serializes to the SAME bytes (no-op save).
//   crypto  = fake encrypt/decrypt on the CFB+EncryptedPackage convention;
//             wrong password throws 'password is incorrect' like upstream.
import type {
  DocxBlock,
  DocxEngineFunctions,
  DocxParsed,
  DocxSaveBlock,
  DocxSaveOptions,
  OoxmlCrypto,
} from "../src/docx";

const FAKE_DOCX_MAGIC = "fake-docx";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface FakeDocxFixture {
  blocks: Array<Record<string, unknown>>;
  extras?: Record<string, unknown>;
  hf?: Record<string, unknown>;
  parts?: Record<string, string>;
}

const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

export function makeFakeDocxBytes(fixture: FakeDocxFixture): Uint8Array {
  const payload = encoder.encode(JSON.stringify({ magic: FAKE_DOCX_MAGIC, ...fixture }));
  const out = new Uint8Array(ZIP_MAGIC.length + payload.length);
  out.set(ZIP_MAGIC);
  out.set(payload, ZIP_MAGIC.length);
  return out;
}

export function makeNonOfficeBytes(): Uint8Array {
  return encoder.encode("this is plainly not an office package");
}

export function makeCorruptZipDocx(): Uint8Array {
  // zip magic but not our package — the fake parse throws like upstream.
  const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const body = encoder.encode(JSON.stringify({ oops: true }));
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

interface FakeDocxPackage {
  magic: string;
  blocks: Array<Record<string, unknown>>;
  extras?: Record<string, unknown>;
  hf?: Record<string, unknown>;
  parts?: Record<string, string>;
}

function decodePackage(bytes: Uint8Array): FakeDocxPackage {
  // PK-headed container → strip the magic and read the fake package JSON.
  const hasZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const payload = hasZip ? bytes.subarray(4) : bytes;
  let pkg: FakeDocxPackage;
  try {
    pkg = JSON.parse(decoder.decode(payload)) as FakeDocxPackage;
  } catch {
    throw new Error("Corrupted zip: invalid central directory");
  }
  if (!pkg || pkg.magic !== FAKE_DOCX_MAGIC) {
    throw new Error("not a docx: missing word/document.xml");
  }
  return pkg;
}

function encodePackage(pkg: Omit<FakeDocxPackage, "magic">): Uint8Array {
  const payload = encoder.encode(JSON.stringify({ magic: FAKE_DOCX_MAGIC, ...pkg }));
  const out = new Uint8Array(ZIP_MAGIC.length + payload.length);
  out.set(ZIP_MAGIC);
  out.set(payload, ZIP_MAGIC.length);
  return out;
}

/** Decode the fake package — accepts PK-headed container or bare payload. */
export function decodeFakeDocx(bytes: Uint8Array): FakeDocxPackage {
  return decodePackage(bytes);
}

export function createFakeDocxEngine(): DocxEngineFunctions & {
  listPackageParts(parsed: DocxParsed): string[];
} {
  return {
    async parseDocx(bytes: Uint8Array): Promise<DocxParsed> {
      const pkg = decodePackage(bytes);
      let idx = 0;
      const blocks: DocxBlock[] = pkg.blocks.map((b) => ({
        id: (b.id as string) ?? "b" + idx,
        type: String(b.type ?? "paragraph"),
        docxIndex: idx++,
        ...(b.hidden === true ? { hidden: true } : {}),
        ...(b.runs ? { runs: b.runs as DocxBlock["runs"] } : {}),
        ...(b as Record<string, unknown>),
      }));
      const parsed: DocxParsed = {
        blocks,
        ...(pkg.extras ? { extras: pkg.extras as DocxParsed["extras"] } : {}),
        internal: {
          originalBytes: bytes,
          originalSnapshot: JSON.stringify({
            blocks,
            extras: pkg.extras ?? {},
            hf: pkg.hf ?? {},
            parts: pkg.parts ?? {},
          }),
          hf: pkg.hf ?? {},
          parts: pkg.parts ?? {},
        },
      };
      return parsed;
    },

    async saveDocx(
      parsed: DocxParsed,
      finalBlocks: DocxSaveBlock[],
      options?: DocxSaveOptions,
    ): Promise<Uint8Array> {
      const internal = (parsed.internal ?? {}) as {
        hf?: Record<string, unknown>;
        parts?: Record<string, string>;
        originalBytes?: Uint8Array;
        originalSnapshot?: string;
      };
      const byIndex = new Map<number, DocxBlock>();
      for (const b of parsed.blocks) if (b.docxIndex !== null) byIndex.set(b.docxIndex, b);
      const hidden = parsed.blocks.filter((b) => b.hidden);
      const outBlocks: Array<Record<string, unknown>> = [];
      const parts = { ...(internal.parts ?? {}) };
      const hf = { ...(internal.hf ?? {}) };
      for (const plan of finalBlocks) {
        switch (plan.kind) {
          case "original": {
            const src = byIndex.get(plan.docxIndex);
            if (src) outBlocks.push(src as unknown as Record<string, unknown>);
            break;
          }
          case "generated":
            outBlocks.push({ type: plan.block.type, runs: plan.block.runs, generated: true });
            break;
          case "xml":
            outBlocks.push({
              type: "xml-fragment",
              xml: plan.xml,
              ...(plan.docxIndex !== undefined ? { docxIndex: plan.docxIndex } : {}),
            });
            break;
          case "image": {
            const n = Object.keys(parts).filter((p) => p.startsWith("word/media/")).length + 1;
            parts["word/media/image" + n + ".png"] = plan.image.base64.slice(0, 16) + "...";
            outBlocks.push({ type: "image", image: { widthPx: plan.image.widthPx, heightPx: plan.image.heightPx } });
            break;
          }
          case "chart":
            parts["word/charts/chart" + (Object.keys(parts).filter((p) => p.startsWith("word/charts/")).length + 1) + ".xml"] = "<chart/>";
            outBlocks.push({ type: "chart", chart: plan.chart });
            break;
        }
      }
      for (const b of hidden) outBlocks.push(b as unknown as Record<string, unknown>);
      if (options) {
        for (const slot of ["header", "footer", "headerFirst", "footerFirst", "headerEven", "footerEven"] as const) {
          if (options[slot] !== undefined) hf[slot] = options[slot];
        }
        if (options.titlePg !== undefined) hf.titlePg = options.titlePg;
        if (options.evenAndOddHeaders !== undefined) hf.evenAndOddHeaders = options.evenAndOddHeaders;
      }
      const candidate = { blocks: outBlocks, extras: (parsed.extras ?? {}) as Record<string, unknown>, hf, parts };
      // Upstream reverse-composition: a save whose resulting package is
      // identical to the parsed one returns the source bytes untouched.
      if (
        internal.originalSnapshot !== undefined &&
        internal.originalBytes !== undefined &&
        JSON.stringify(candidate) === internal.originalSnapshot
      ) {
        return internal.originalBytes;
      }
      return encodePackage(candidate);
    },

    listPackageParts(parsed: DocxParsed): string[] {
      const internal = (parsed.internal ?? {}) as { parts?: Record<string, string> };
      return Object.keys(internal.parts ?? {});
    },
  };
}

// ── fake crypto (CFB + EncryptedPackage convention) ────────────────────────

const FAKE_CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function simpleKey(password: string): number {
  let h = 0;
  for (let i = 0; i < password.length; i++) h = (h * 31 + password.charCodeAt(i)) >>> 0;
  return h;
}

/** Wrap plaintext docx bytes in the fake encrypted container. */
export function fakeEncryptDocx(plain: Uint8Array, password: string): Uint8Array {
  const head = new Uint8Array(FAKE_CFB_MAGIC);
  const utf16 = encryptedStreamMarker();
  const payload = encoder.encode(JSON.stringify({ check: simpleKey(password), inner: Array.from(plain) }));
  const out = new Uint8Array(head.length + utf16.length + payload.length);
  out.set(head);
  out.set(utf16, head.length);
  out.set(payload, head.length + utf16.length);
  return out;
}

/** UTF-16LE bytes of the 'EncryptedPackage' stream name the adapter sniffs. */
function encryptedStreamMarker(): Uint8Array {
  const name = "EncryptedPackage";
  const out = new Uint8Array(name.length * 2);
  for (let i = 0; i < name.length; i++) {
    out[i * 2] = name.charCodeAt(i);
    out[i * 2 + 1] = 0;
  }
  return out;
}

export function createFakeDocxCrypto(): OoxmlCrypto {
  return {
    async decrypt(bytes: Uint8Array, password: string): Promise<Uint8Array> {
      const head = FAKE_CFB_MAGIC.every((b, i) => bytes[i] === b);
      if (!head) throw new Error("not an encrypted package");
      const utf16Len = "EncryptedPackage".length * 2;
      const payload = decoder.decode(bytes.subarray(8 + utf16Len));
      let obj: { check: number; inner: number[] };
      try {
        obj = JSON.parse(payload) as { check: number; inner: number[] };
      } catch {
        throw new Error("unsupported: not a fake encrypted container");
      }
      // The container stores a key derived from the password — a verifier
      // mismatch reprompts, exactly like upstream ('password is incorrect').
      if (obj.check !== simpleKey(password)) {
        throw new Error("password is incorrect");
      }
      return new Uint8Array(obj.inner);
    },
    encrypt(plain: Uint8Array, password: string): Uint8Array {
      return fakeEncryptDocx(plain, password);
    },
  };
}

/** Alias kept for readability at call sites that emphasise verification. */
export function createFakeDocxCryptoWithCheck(_expected?: string): OoxmlCrypto {
  return createFakeDocxCrypto();
}
