import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const rendererDir = fileURLToPath(new URL(".", import.meta.url));

function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return componentFiles(path);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [path] : [];
  });
}

// Icons come from lucide-react, the set and stroke the shared Office screens in
// this window already use; a hand-drawn <svg> drifts from both. A canvas that
// draws SVG on purpose (a shape or page preview) gets a named exception here.
it("draws no inline icon svg in the renderer", () => {
  for (const file of componentFiles(rendererDir)) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(/<svg[\s>]/);
  }
});
