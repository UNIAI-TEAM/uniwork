// Fixture test for the copy rule in eslint.config.mjs (i18next/no-literal-string, audit
// "i18n-guard-scope-rtl"): a literal a person reads or hears is red wherever it sits in JSX — a
// text node, an expression, or a prop such as a screen reader's label or a placeholder — and a
// prop that is not copy (a testID, a class) stays green.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const appRoot = path.resolve(__dirname, "..");
const FIXTURE = "components/__copy_fixture__.tsx";
// The copy rule for plain modules and the number rule (below); one project service serves both fixtures.
const TS_FIXTURE = "data/__copy_fixture__.ts";
const eslint = new ESLint({
  cwd: appRoot,
  overrideConfig: [{ files: [FIXTURE, TS_FIXTURE], languageOptions: { parserOptions: { projectService: { allowDefaultProject: [FIXTURE, TS_FIXTURE] } } } }],
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

// The same rule for copy built in plain modules (audit "copy lint does not cover .ts modules"), and the number and date
// rule (audit "number-format-and-server-copy"): only lib/locale-format.ts builds an Intl formatter.

async function restricted(body: string): Promise<string[]> {
  const code = `declare const toast: { error(m: string): void };\ndeclare const Alert: { alert(m: string): void };\ndeclare const Notifications: { scheduleNotificationAsync(r: unknown): void };\ndeclare const t: (key: string) => string;\nexport function f(n: number): void {\n  ${body};\n}\n`;
  const [result] = await eslint.lintText(code, { filePath: path.join(appRoot, TS_FIXTURE) });
  const messages = result?.messages ?? [];
  expect(messages.filter((m) => m.fatal)).toEqual([]);
  return messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

describe("copy and formatting in .ts modules", { timeout: 60_000 }, () => {
  it.each([
    ['toast.error("Không gửi được")'],
    ["toast.error(`Failed ${n}`)"],
    ['Alert.alert("Delete?")'],
    ['Notifications.scheduleNotificationAsync({ content: { title: "Cuộc gọi nhỡ", body: t("x") } })'],
    ["void n.toFixed(1)"],
    ['void n.toLocaleString("vi")'],
    ['void new Intl.NumberFormat("vi").format(n)'],
  ])("%s is red", async (body) => {
    expect(await restricted(body)).toHaveLength(1);
  });

  it.each([['toast.error(t("chat.send_failed"))'], ['Notifications.scheduleNotificationAsync({ identifier: "call-ring:1", content: { title: t("x") } })'], ["toast.error(`${t(\"a\")}: ${n}`)"]])(
    "%s is green",
    async (body) => {
      expect(await restricted(body)).toEqual([]);
    },
  );
});

// Audit "rtl-not-ready": spacing is logical (ms-/me-/ps-/pe-), so a right-to-left language is not a layout rewrite.
describe("logical spacing", { timeout: 60_000 }, () => {
  it.each([['void "flex-row pl-4"'], ['void ["gap-2", "active:mr-2"]'], ["void `px-2 ml-[72px] ${n}`"], ['void "-ml-2.5"']])("%s is red", async (body) => {
    expect((await restricted(body)).filter((m) => m.includes("logical spacing"))).toHaveLength(1);
  });

  it.each([['void "flex-row ps-4 pe-2 -ms-2.5"'], ['void "html-pl mpl-3 text-pl-4x"'], ["void `ms-[72px] ${n}`"]])("%s is green", async (body) => {
    expect((await restricted(body)).filter((m) => m.includes("logical spacing"))).toEqual([]);
  });
});
