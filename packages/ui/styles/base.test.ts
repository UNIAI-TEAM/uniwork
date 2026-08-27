import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "base.css"), "utf8");
const componentsDir = join(__dirname, "..", "components", "ui");

/**
 * The registry primitives style orientation with `data-horizontal:` and
 * `data-vertical:` variants. Base UI emits `data-orientation="horizontal"`,
 * not a bare `data-horizontal` attribute, so those variants match nothing
 * unless the stylesheet defines them — which is how a Separator rendered as
 * a 0×0 box. Pin the definition next to the usages.
 */
describe("orientation variants", () => {
  const users = readdirSync(componentsDir).filter((f) => {
    if (!f.endsWith(".tsx") || f.includes(".test.")) return false;
    return /data-(horizontal|vertical):/.test(readFileSync(join(componentsDir, f), "utf8"));
  });

  it("are used by at least one primitive (otherwise drop the variant)", () => {
    expect(users.length).toBeGreaterThan(0);
  });

  it("are declared as custom variants keyed on data-orientation", () => {
    expect(styles).toMatch(/@custom-variant data-horizontal \(&\[data-orientation="horizontal"\]\)/);
    expect(styles).toMatch(/@custom-variant data-vertical \(&\[data-orientation="vertical"\]\)/);
  });
});

describe("caret-blink", () => {
  it("defines the keyframes the OTP fake caret animates with", () => {
    expect(styles).toMatch(/@keyframes caret-blink/);
    expect(styles).toMatch(/\.animate-caret-blink\s*\{/);
  });
});
