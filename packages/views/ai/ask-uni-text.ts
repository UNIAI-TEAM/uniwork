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
