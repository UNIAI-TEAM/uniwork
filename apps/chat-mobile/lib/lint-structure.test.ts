// Fixture test for the structure rules in eslint.config.mjs: data/ never
// reaches up into components/ or app/ (not even for a type), lib/ narrows
// with guards instead of type assertions, and no source line runs past 150
// characters. A rule that silently drops out of the config turns its red case
// green here.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const DATA = "data/__structure_fixture__.ts";
const LIB = "lib/__structure_fixture__.ts";
const COMPONENT = "components/__structure_fixture__.tsx";
const eslint = new ESLint({
  cwd: appRoot,
  overrideConfig: [
    {
      files: [DATA, LIB, COMPONENT],
      languageOptions: { parserOptions: { projectService: { allowDefaultProject: [DATA, LIB, COMPONENT] } } },
    },
  ],
});

async function messages(file: string, code: string, rule: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, file) });
  const all = result?.messages ?? [];
  expect(all.filter((m) => m.fatal)).toEqual([]);
  return all.filter((m) => m.ruleId === rule).map((m) => m.message);
}

const BOUNDARY = "@typescript-eslint/no-restricted-imports";

describe("structure lint", { timeout: 60_000 }, () => {
  it.each([
    'import { usageStatsEnabled } from "@/components/app/privacy";',
    'import type { ChatRoomContext } from "@/components/chat/use-room-context";',
    'import { x } from "../components/chat/x";',
    'import Screen from "@/app/(app)/account";',
  ])("data/ importing %s is red", async (code) => {
    const found = await messages(DATA, `${code}\nexport const used = 1;\n`, BOUNDARY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/data\/ sits below components\/ and app\//);
  });

  it.each([
    'import { toast } from "@/data/stores/toast-store";',
    'import { pathOf } from "@/lib/unknown-shape";',
    'import { parseWithFallback } from "@uniwork/core/api/schema";',
  ])("data/ importing %s is green", async (code) => {
    expect(await messages(DATA, `${code}\nexport const used = 1;\n`, BOUNDARY)).toEqual([]);
  });

  it("data/ keeps the ADR 0011 boundary its block restates", async () => {
    expect(await messages(DATA, 'import { x } from "@uniwork/views/chat/x";\nexport const y = x;\n', BOUNDARY)).toHaveLength(1);
  });

  it.each([
    ["an `as` assertion", "export const read = (value: unknown): string => value as string;"],
    ["an angle-bracket assertion", "export const read = (value: unknown): string => <string>value;"],
    ["a double cast", "export const read = (value: unknown): number => value as unknown as number;"],
  ])("lib/ with %s is red", async (_name, code) => {
    expect(await messages(LIB, code, "@typescript-eslint/consistent-type-assertions")).not.toEqual([]);
  });

  it("lib/ narrowing with a guard, or `as const`, is green", async () => {
    const code =
      'import { pathOf } from "./unknown-shape";\n' +
      'export const KINDS = ["a", "b"] as const;\n' +
      'export const code = (err: unknown): string | null => { const c = pathOf(err, "code"); return typeof c === "string" ? c : null; };\n';
    expect(await messages(LIB, code, "@typescript-eslint/consistent-type-assertions")).toEqual([]);
  });

  it("a source line past 150 characters is red, a URL is not", async () => {
    const long = `export const label = "${"x".repeat(150)}";\n`;
    expect(await messages(COMPONENT, long, "max-len")).toHaveLength(1);
    const url = `// https://developer.android.com/develop/ui/views/notifications/call-style${"/x".repeat(60)}\nexport const ok = 1;\n`;
    expect(await messages(COMPONENT, url, "max-len")).toEqual([]);
  });
});
