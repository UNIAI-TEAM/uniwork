import type { AiCitation } from "@uniwork/core/types";

/** The answer as plain text: a run of adjacent `[S#]` becomes its known names joined by ", "; unknown ones are dropped with their leading space. */
export function answerPlainText(content: string, byId: Map<string, AiCitation>): string {
  return content.replace(/( ?)(\[S\d+\](?: ?\[S\d+\])*)/g, (_m, space: string, run: string) => {
    const names = [...run.matchAll(/\[S(\d+)\]/g)].flatMap((m) => {
      const c = byId.get(`S${m[1]}`);
      return c ? [c.title || c.kind] : [];
    });
    return names.length ? `${space}${names.join(", ")}` : "";
  });
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
