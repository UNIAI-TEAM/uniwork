// Ported from usf apps/mobile/lib/utils.ts. tailwind-merge learns the text
// roles (type-scale.json) as font sizes: unknown to it, `text-footnote` would
// read as a colour and drop beside `text-muted-foreground`.
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import typeScale from "./type-scale.json";

const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: Object.keys(typeScale) }] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
