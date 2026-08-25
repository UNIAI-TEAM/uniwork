import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every package the ported tier-1 files import. Sourced by scanning
// usf/packages/ui for both quote styles — a single-quoted import is easy to
// miss and shows up only as a runtime failure.
const REQUIRED = [
  "@base-ui/react", "@emoji-mart/data", "@number-flow/react",
  "@tanstack/react-table", "@tanstack/react-virtual",
  "class-variance-authority", "clsx", "cmdk", "embla-carousel-react",
  "emoji-mart", "input-otp", "katex", "linkify-it", "lucide-react",
  "next-themes", "react", "react-day-picker", "react-dom", "react-i18next",
  "react-markdown", "react-resizable-panels", "recharts", "rehype-katex",
  "rehype-raw", "rehype-sanitize", "remark-breaks", "remark-gfm",
  "remark-math", "shiki", "sonner", "tailwind-merge", "unicode-animations",
  "vaul",
];

describe("packages/ui dependencies", () => {
  it("declares every package the ported files import", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    const missing = REQUIRED.filter((name) => !declared.has(name));
    expect(missing, `missing from packages/ui deps: ${missing.join(", ")}`)
      .toEqual([]);
  });
});
