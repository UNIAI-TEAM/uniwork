// Fixture test for the copy rule in eslint.config.mjs (i18next/no-literal-string, audit
// "i18n-guard-scope-rtl"): a literal a person reads or hears is red wherever it sits in JSX — a
// text node, an expression, or a prop such as a screen reader's label or a placeholder — and a
// prop that is not copy (a testID, a class) stays green.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const FIXTURE = "components/__copy_fixture__.tsx";
const eslint = new ESLint({
  cwd: appRoot,
  overrideConfig: [{ files: [FIXTURE], languageOptions: { parserOptions: { projectService: { allowDefaultProject: [FIXTURE] } } } }],
});

async function copyMessages(jsx: string): Promise<string[]> {
  const code = `import { Text, TextInput, View } from "react-native";\nconst t = (key: string) => key;\nexport function F() {\n  return ${jsx};\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, FIXTURE) });
  const messages = result?.messages ?? [];
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages.filter((m) => m.ruleId === "i18next/no-literal-string").map((m) => m.message);
}

describe("the copy rule", { timeout: 60_000 }, () => {
  it.each([
    ["<Text>Xin chào</Text>"],
    ["<Text>{\"Xin chào\"}</Text>"],
    ['<View accessible accessibilityLabel="Đóng" />'],
    ['<View accessible accessibilityLabel={t("close")} accessibilityHint="Mở cài đặt" />'],
    ['<TextInput placeholder="Search" accessibilityLabel={t("search")} />'],
  ])("%s is red", async (jsx) => {
    expect(await copyMessages(jsx)).toHaveLength(1);
  });

  it.each([
    ['<Text testID="greeting" className="text-body">{t("hello")}</Text>'],
    ['<TextInput placeholder={t("search")} accessibilityLabel={t("search")} autoComplete="email" />'],
  ])("%s is green", async (jsx) => {
    expect(await copyMessages(jsx)).toEqual([]);
  });
});
