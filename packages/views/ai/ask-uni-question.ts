import type { JSONContent } from "@tiptap/core";
import type { AskUniObjectKind } from "./ask-uni-object-picker";

export interface AskUniMentionCard {
  kind: AskUniObjectKind;
  id: string;
  label: string;
}

/** The composer's document as the question text (each card reads as its label, spaces collapsed) and the cards it names, each once. */
export function serializeQuestion(doc: JSONContent): { text: string; mentions: AskUniMentionCard[] } {
  const mentions = new Map<string, AskUniMentionCard>();
  const read = (node: JSONContent): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    if (node.type === "askUniMention") {
      const card = node.attrs as AskUniMentionCard;
      const key = `${card.kind}:${card.id}`;
      if (!mentions.has(key)) mentions.set(key, { kind: card.kind, id: card.id, label: card.label });
      return card.label;
    }
    return (node.content ?? []).map(read).join("");
  };
  // A pick adds its own space, so the one typed after it would double: runs of spaces read as one, line breaks stay.
  const text = (doc.content ?? []).map(read).join("\n").replace(/[ \t]+/g, " ").trim();
  return { text, mentions: [...mentions.values()] };
}
