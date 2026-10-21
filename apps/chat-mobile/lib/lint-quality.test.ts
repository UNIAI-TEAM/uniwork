// Fixture test for the app's quality rules in eslint.config.mjs (ADR 0037):
// no `any`, the React Native accessibility rules, and no JSX literal text. A
// rule that silently drops out of the config turns its case green here.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const FIXTURE = "components/__quality_fixture__.tsx";
const eslint = new ESLint({
  cwd: appRoot,
  overrideConfig: [{
    files: [FIXTURE],
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: [FIXTURE] } } },
  }],
});

async function ruleIds(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, FIXTURE) });
  const messages = result?.messages ?? [];
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages.map((m) => m.ruleId ?? "");
}

const head = 'import { Pressable, Text, TouchableOpacity, View } from "react-native";\nimport { useTranslation } from "react-i18next";\n';

describe("mobile quality lint", { timeout: 60_000 }, () => {
  it.each([
    ["an explicit any", "export const parse = (raw: any): string => String(raw);", "@typescript-eslint/no-explicit-any"],
    [
      "a role React Native does not know",
      'export const A = () => { const { t } = useTranslation(); return <Pressable accessibilityRole="anchor" accessibilityLabel={t("a")} />; };',
      "react-native-a11y/has-valid-accessibility-role",
    ],
    [
      "an invalid accessibility state",
      'export const A = () => { const { t } = useTranslation(); return <Pressable accessibilityRole="button" accessibilityState={{ pressed: true }} accessibilityLabel={t("a")} />; };',
      "react-native-a11y/has-valid-accessibility-state",
    ],
    [
      "a touchable inside a touchable",
      'export const A = () => <View accessible><TouchableOpacity accessibilityRole="button" /></View>;',
      "react-native-a11y/no-nested-touchables",
    ],
    [
      "an Android live region React Native does not know",
      'export const A = () => <View accessibilityLiveRegion="loud" />;',
      "react-native-a11y/has-valid-accessibility-live-region",
    ],
    ["literal JSX text", "export function A() {\n  return <Text>Xin chào</Text>;\n}", "i18next/no-literal-string"],
  ])("%s is red", async (_name, code, rule) => {
    expect(await ruleIds(head + code)).toContain(rule);
  });

  it("a labelled, translated control with a valid role and state is green", async () => {
    const code =
      'export const A = () => { const { t } = useTranslation(); return <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t("chat.send")}><Text>{t("chat.send")}</Text></Pressable>; };';
    expect(await ruleIds(head + code)).toEqual([]);
  });
});
