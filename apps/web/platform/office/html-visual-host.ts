import type { HtmlEngine, HtmlUpstream, UpstreamParseMap, UpstreamPatchSet } from "@uniwork/office-engine/html";
import { buildHtmlParseMap } from "./html-parse-map";

/**
 * What the HTML visual editor (packages/views/office/html/visual) needs from the
 * web host: the parse map of the live source, the engine revision, and a way to
 * apply an H3 patch set. Structural twin of `HtmlVisualEditHost` in views.
 */
interface HtmlVisualEditHostPort {
  parseMap(text: string): UpstreamParseMap;
  revision(): number;
  applyPatchSet(set: UpstreamPatchSet): void;
}

interface HostOptions {
  engine: Pick<HtmlEngine, "snapshot" | "parseMap">;
  /** The open document's engine ref, or null before open / after dispose. */
  ref(): string | null;
  /** The text handle's own `setText`: it records undo history, bumps the dirty
   * generation, writes the engine and notifies the views. A visual edit is an
   * ordinary text edit, so Save, undo and the draft see it like any other. */
  setText(next: string): void;
  upstream: Pick<HtmlUpstream, "validatePatchSet" | "applyPatches">;
}

/** Patches are in the ORIGINAL coordinates: in bounds, sorted, not overlapping. */
function patchError(set: UpstreamPatchSet, length: number): string | null {
  let cursor = -1;
  const ordered = [...set.patches].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const patch of ordered) {
    if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.to < patch.from || patch.to > length) return "bounds";
    if (patch.from < cursor) return "overlap";
    cursor = patch.to;
  }
  return null;
}

export function createHtmlVisualEditHost({ engine, ref, setText, upstream }: HostOptions): HtmlVisualEditHostPort {
  const openRef = (): string => {
    const current = ref();
    if (current === null) throw new Error("visual edit: the document is not open");
    return current;
  };
  return {
    parseMap(text) {
      const current = openRef();
      const snapshot = engine.snapshot(current);
      // The engine caches one map per revision (same sids for the same text);
      // a text the engine has not seen yet gets a fresh, unmatched map.
      return text === snapshot.text ? engine.parseMap(current) : buildHtmlParseMap(text, snapshot.revision, null);
    },
    revision: () => engine.snapshot(openRef()).revision,
    applyPatchSet(set) {
      const snapshot = engine.snapshot(openRef());
      const stale = upstream.validatePatchSet(set, snapshot.revision, snapshot.text.length);
      if (stale) throw new Error(`visual edit rejected: ${stale.kind}`);
      const problem = patchError(set, snapshot.text.length);
      if (problem) throw new Error(`visual edit rejected: ${problem}`);
      setText(upstream.applyPatches(snapshot.text, set.patches));
    },
  };
}
