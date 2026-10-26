import { cn } from "@uniwork/ui/lib/utils";

/**
 * One line that ellipsizes at a word boundary ("…hằng tuần…", never "tuần …"
 * or "đồng b…"): every later word is an atomic inline box carrying its leading
 * space, and text-overflow hides an atomic box whole, space included.
 */
export function WordClip({ text, className }: { text: string; className?: string }) {
  const [first, ...rest] = text.split(" ");
  return (
    <span className={cn("truncate", className)}>
      {first}
      {rest.map((word, i) => (
        <span key={i} className="inline-block whitespace-pre">{` ${word}`}</span>
      ))}
    </span>
  );
}
