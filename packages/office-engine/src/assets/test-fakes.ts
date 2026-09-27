// UNIT-TEST FAKES ONLY. Production code never imports this module
// (src/assets/test-fakes.guard.test.ts fails if it does). The real seams are
// bound to packages/office-upstream by markdown/vendor.ts and html/vendor.ts.

import type { HtmlUpstream, UpstreamPatch, UpstreamPatchError, UpstreamPatchSet } from "../html/seam";
import type { MarkdownUpstream } from "../markdown/seam";
import type { AssetBytesSource, AssetStagingPort, PublishInput } from "./save";

interface Range {
  start: number;
  end: number;
  source: string;
  angle: boolean;
}

function fencedRanges(md: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
  for (const m of md.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

function mdRanges(md: string): Range[] {
  const fences = fencedRanges(md);
  const inFence = (i: number) => fences.some(([a, b]) => i >= a && i < b);
  const out: Range[] = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) {
    if (inFence(m.index)) continue;
    const token = m[1]!;
    const start = m.index + m[0].indexOf(token);
    const angle = token.startsWith("<");
    out.push({
      start: angle ? start + 1 : start,
      end: angle ? start + token.length - 1 : start + token.length,
      source: angle ? token.slice(1, -1) : token,
      angle,
    });
  }
  for (const m of md.matchAll(/<img\s[^>]*?src="([^"]*)"/gi)) {
    if (inFence(m.index)) continue;
    const start = m.index + m[0].length - 1 - m[1]!.length;
    out.push({ start, end: start + m[1]!.length, source: m[1]!, angle: true });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function fakeMarkdownUpstream(): MarkdownUpstream {
  return {
    extractMarkdownImageSources: (md) => mdRanges(md).map((r) => r.source),
    rewriteMarkdownImageSources(md, rewrites) {
      let out = "";
      let cursor = 0;
      for (const r of mdRanges(md)) {
        const next = rewrites.get(r.source);
        if (next === undefined) continue;
        const wrap = !r.angle && /[\s()]/.test(next);
        out += md.slice(cursor, r.start) + (wrap ? "<" + next + ">" : next);
        cursor = r.end;
      }
      return cursor === 0 ? md : out + md.slice(cursor);
    },
  };
}

function sortPatches(patches: readonly UpstreamPatch[]): UpstreamPatch[] {
  return [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
}

export function fakeHtmlUpstream(options: { extraImages?: (html: string) => string[] } = {}): HtmlUpstream {
  return {
    buildParseMap: (_text, version) => ({ version, elements: [], bySid: new Map(), errorCount: 0 }),
    validatePatchSet(set: UpstreamPatchSet, currentVersion: number, length: number): UpstreamPatchError | null {
      if (set.baseVersion !== currentVersion) return { kind: "stale", baseVersion: set.baseVersion, currentVersion };
      let cursor = -1;
      const sorted = sortPatches(set.patches);
      for (let i = 0; i < sorted.length; i++) {
        const p = sorted[i]!;
        if (p.from < 0 || p.to < p.from || p.to > length) return { kind: "bounds", index: i };
        if (p.from < cursor) return { kind: "overlap", index: i };
        cursor = p.to;
      }
      return null;
    },
    applyPatches(text, patches) {
      let out = text;
      for (const p of sortPatches(patches).reverse()) out = out.slice(0, p.from) + p.text + out.slice(p.to);
      return out;
    },
    isDocEmpty: (text) =>
      !/<(?:img|svg|video|audio|canvas|iframe|picture|object|embed)\b/i.test(text) &&
      text.replace(/<(title|script|style)[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, "").trim() === "",
    extractDocumentImageSources: (html) => [
      ...[...html.matchAll(/<img\s[^>]*?src="([^"]*)"/gi)].map((m) => m[1]!),
      ...(options.extraImages?.(html) ?? []),
    ],
  };
}

/** In-memory committed store standing in for the host read/staging/publish ports. */
export interface FakeStore {
  source: AssetBytesSource;
  staging: AssetStagingPort;
  publish(input: PublishInput & { document_id: string }): Promise<{ version: number }>;
  published: Array<PublishInput & { document_id: string }>;
  staged: string[];
  reads: string[];
  /** Committed bytes by document id, then by key. */
  committed: Map<string, Map<string, Uint8Array>>;
  failRead?: (key: string) => boolean;
  failStage?: (key: string) => boolean;
  corruptRead?: (key: string) => boolean;
}

export function fakeStore(documentId: string, initial: Record<string, Uint8Array> = {}): FakeStore {
  const committed = new Map<string, Map<string, Uint8Array>>([[documentId, new Map(Object.entries(initial))]]);
  const pendingStage = new Map<string, Uint8Array>();
  const store: FakeStore = {
    committed,
    published: [],
    staged: [],
    reads: [],
    source: {
      async read(key) {
        store.reads.push(key);
        if (store.failRead?.(key)) throw new Error("disk on fire at C:\\secret\\" + key);
        const bytes = committed.get(documentId)?.get(key);
        if (!bytes) throw new Error("missing " + key);
        return store.corruptRead?.(key) ? new Uint8Array([...bytes, 0]) : bytes;
      },
    },
    staging: {
      async stage(input) {
        if (store.failStage?.(input.key)) throw new Error("staging unavailable");
        const id = "stg-" + (store.staged.length + 1);
        store.staged.push(input.key);
        pendingStage.set(id, input.bytes);
        return { staged_id: id };
      },
    },
    async publish(input) {
      const bytes = new Map<string, Uint8Array>();
      for (const s of input.staged) bytes.set(s.key, pendingStage.get(s.staged_id)!);
      committed.set(input.document_id, bytes);
      store.published.push(input);
      return { version: store.published.length };
    },
  };
  return store;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
