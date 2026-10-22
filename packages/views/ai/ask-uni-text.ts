import type { AiCitation } from "@uniwork/core/types";

/** The answer as plain text: each known `[S#]` becomes the object's name, an unknown one is dropped with its leading space. */
export function answerPlainText(content: string, byId: Map<string, AiCitation>): string {
  return content.replace(/( ?)\[S(\d+)\]/g, (_m, space: string, n: string) => {
    const c = byId.get(`S${n}`);
    return c ? `${space}${c.title || c.kind}` : "";
  });
}
