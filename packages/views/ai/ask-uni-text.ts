import type { AiCitation } from "@uniwork/core/types";

/** The answer as plain text: a run of adjacent `[S#]` becomes its known names joined by ", "; unknown ones are dropped with their leading space. */
export function answerPlainText(content: string, byId: Map<string, AiCitation>): string {
  return dropEchoedNames(content, byId).replace(/( ?)(\[S\d+\](?: ?\[S\d+\])*)/g, (_m, space: string, run: string) => {
    const names = [...run.matchAll(/\[S(\d+)\]/g)].flatMap((m) => {
      const c = byId.get(`S${m[1]}`);
      return c ? [c.title || c.kind] : [];
    });
    return names.length ? `${space}${names.join(", ")}` : "";
  });
}

const MARKER = /\[S(\d+)\]/g;
const OPEN = /^(\*\*|__|\*|_)/;
const CLOSE = /(\*\*|__|\*|_)$/;
// The echo is a whole word run: no letter or digit right outside it.
const WORD = /[\p{L}\p{N}\p{M}]/u;

// Case-blind but not accent-blind: "hợp" is not an echo of "Họp".
const same = (a: string, b: string) => a.normalize("NFC").toLocaleLowerCase("vi") === b.normalize("NFC").toLocaleLowerCase("vi");

/** Where an echo of `title` right after `at` ends (wrapping marks included), or -1. */
function echoAfter(text: string, at: number, title: string): number {
  const start = at + (/^[ \t]*/.exec(text.slice(at))?.[0].length ?? 0);
  const mark = OPEN.exec(text.slice(start))?.[0] ?? "";
  const from = start + mark.length;
  const to = from + title.length;
  if (!same(text.slice(from, to), title)) return -1;
  if (mark) return text.startsWith(mark, to) ? to + mark.length : -1;
  return WORD.test(text.charAt(to)) ? -1 : to;
}

/** Where an echo of `title` right before `at` starts (wrapping marks included), or -1. */
function echoBefore(text: string, at: number, title: string): number {
  const head = text.slice(0, at).replace(/[ \t]+$/, "");
  const mark = CLOSE.exec(head)?.[0] ?? "";
  const to = head.length - mark.length;
  const from = to - title.length;
  if (from < 0 || !same(text.slice(from, to), title)) return -1;
  if (mark) return text.slice(0, from).endsWith(mark) ? from - mark.length : -1;
  return from > 0 && WORD.test(text.charAt(from - 1)) ? -1 : from;
}

/**
 * The answer without the object names the model wrote right next to their own `[S#]` ("[S4] Thiết kế trang chủ."),
 * since the marker already shows that name in the same place, so the sentence reads the same. Only the whole title
 * goes, as whole words (case-blind, accents kept, bold or italic marks around it included); every other word stays,
 * and a marker the map does not know is left alone.
 */
export function dropEchoedNames(content: string, byId: Map<string, AiCitation>): string {
  const cuts: [number, number][] = [];
  let floor = 0;
  for (const m of content.matchAll(MARKER)) {
    const start = m.index;
    const end = start + m[0].length;
    const title = byId.get(`S${m[1]}`)?.title.trim() ?? "";
    if (!title || start < floor) continue;
    const after = echoAfter(content, end, title);
    if (after >= 0) {
      cuts.push([end, after]);
      floor = after;
      continue;
    }
    const before = echoBefore(content, start, title);
    if (before >= floor) {
      cuts.push([before, start]);
      floor = end;
    }
  }
  let out = "";
  let at = 0;
  for (const [from, to] of cuts) {
    out += content.slice(at, from);
    at = to;
  }
  return out + content.slice(at);
}

const foldChar = (c: string) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");

/** Accent-blind, case-blind form of a string; Vietnamese `đ` folds to `d`. */
export function foldText(s: string): string {
  return Array.from(s, foldChar).join("");
}

/**
 * Where `query` sits in `title`, as indices into the ORIGINAL title. The fold runs per code point and
 * remembers where each folded char came from, so a decomposed title (base letter + mark) still maps back right.
 */
export function matchRange(title: string, query: string): [number, number] | null {
  const needle = foldText(query.trim());
  if (!needle) return null;
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const cp of title) {
    const f = foldChar(cp);
    if (f === "" && ends.length > 0) ends[ends.length - 1] = at + cp.length; // a lone mark joins the letter before it
    for (const ch of f) {
      folded += ch;
      for (let k = 0; k < ch.length; k++) {
        starts.push(at);
        ends.push(at + cp.length);
      }
    }
    at += cp.length;
  }
  const i = folded.indexOf(needle);
  if (i < 0) return null;
  return [starts[i]!, ends[i + needle.length - 1]!];
}
