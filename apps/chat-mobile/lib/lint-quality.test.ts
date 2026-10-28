// Fixture test for the app's quality rules in eslint.config.mjs (ADR 0043):
// no `any`, the React Native accessibility rules, no JSX literal text, no
// console call outside data/logger.ts, no react-native Modal outside
// components/ui/call-aware-modal.tsx, and no endpoint or command called from
// a screen or a component (the mutation layer, data/mutations/command.ts), and
// no failure swallowed by a `.catch(() => undefined)` (data/report.ts › bestEffort), no
// spinner without a label, and no effect whose body is an expression (its value becomes the cleanup). A
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
    ["a console call (logs go through data/logger.ts)", 'export const log = () => console.warn("x");', "no-console"],
    ["a non-null assertion in a component (the model layer narrows)", "export const f = (x?: { a: string }) => x!.a;", "@typescript-eslint/no-non-null-assertion"],
    ["a failure swallowed with no trace", "export const f = (p: Promise<void>) => p.catch(() => undefined);", "no-restricted-syntax"],
    ["a failure swallowed as null", "export const f = (p: Promise<number>) => p.catch(() => null);", "no-restricted-syntax"],
    ["a failure swallowed by an empty block", "export const f = (p: Promise<void>) => p.catch(() => {});", "no-restricted-syntax"],
    ["a failure swallowed as an empty list", "export const f = (p: Promise<number[]>) => p.catch(() => []);", "no-restricted-syntax"],
    [
      "a spinner that does not say what it waits for",
      'import { ActivityIndicator } from "react-native";\nexport const A = () => <ActivityIndicator />;',
      "no-restricted-syntax",
    ],
    [
      "an effect that hands React a call's value as its cleanup (a persisted store's set returns a Promise)",
      'import { useEffect } from "react";\nexport function useKeep(save: () => Promise<void>) {\n  useEffect(() => save(), [save]);\n}',
      "no-restricted-syntax",
    ],
    [
      "a sliding CallAwareModal (a sheet is a draggable BottomSheet)",
      'import { CallAwareModal } from "@/components/ui/call-aware-modal";\nexport const A = () => <CallAwareModal visible animationType="slide" />;',
      "no-restricted-syntax",
    ],
    [
      "react-native's Modal (a sheet must close for a ringing call: CallAwareModal)",
      'import { Modal } from "react-native";\nexport const A = () => <Modal visible />;',
      "@typescript-eslint/no-restricted-imports",
    ],
  ])("%s is red", async (_name, code, rule) => {
    expect(await ruleIds(head + code)).toContain(rule);
  });

  it.each([
    'import { chatApi } from "@/data/chat-api";\nexport const go = () => chatApi.signalTyping("w", "r");',
    'import { editMessage } from "@/data/chat-actions";\nexport const x = editMessage;',
    'import { toggleReaction } from "@/data/pending-ops";\nexport const x = toggleReaction;',
    'import { sendChatMessage } from "@/data/chat-send";\nexport const x = sendChatMessage;',
    'import { safetyApi } from "@/data/safety-api";\nexport const x = safetyApi;',
    'import { setBlocked } from "@/data/safety-actions";\nexport const x = setBlocked;',
    'import { accountApi } from "@/data/account-api";\nexport const x = accountApi;',
    'import { chatApi } from "../../data/chat-api";\nexport const x = chatApi;',
    'import { revokeDevice } from "@/data/queries/devices";\nexport const x = revokeDevice;',
    'import { answerAiConsent } from "@/data/ai-consent";\nexport const x = answerAiConsent;',
    'import { setPushEnabled } from "@/data/push";\nexport const x = setPushEnabled;',
    'import { runSignIn } from "@/data/auth/sign-in";\nexport const x = runSignIn;',
    'import { signInMethodsApi } from "@/data/auth/methods-api";\nexport const x = signInMethodsApi;',
    'import { nativeSignIn } from "@/data/auth/flow";\nexport const x = nativeSignIn;',
    // The challenge, the ticket and its nonce, and the step-up token's keeping, stay in data/.
    'import { pendingTicket } from "@/data/auth/pending-sign-in";\nexport const x = pendingTicket;',
    'import { pendingChallenge } from "@/data/auth/pending-sign-in";\nexport const x = pendingChallenge;',
    'import { holdStep } from "@/data/auth/pending-sign-in";\nexport const x = holdStep;',
    'import { holdStepUp } from "@/data/auth/step-up-store";\nexport const x = holdStepUp;',
    'import { withHeldStepUp } from "@/data/auth/step-up-store";\nexport const x = withHeldStepUp;',
    'import { api } from "@/data/api";\nexport const x = api;',
    'import { api } from "../../data/api";\nexport const x = api;',
  ])("a component calling an endpoint or a command is red: %s", async (code) => {
    expect(await ruleIds(code)).toContain("@typescript-eslint/no-restricted-imports");
  });

  it("a component may take the endpoints' types and the mutation hooks", async () => {
    const code =
      'import type { ChatApi } from "@/data/chat-api";\nimport type { ApiClient } from "@/data/api";\nimport { useEditMessage } from "@/data/mutations/messages";\nimport { useAnswerAiConsent } from "@/data/mutations/account";\nimport { useSetPushEnabled } from "@/data/mutations/push";\nimport { isPushEnabled } from "@/data/push";\nimport { devicesOptions } from "@/data/queries/devices";\nimport type { SignInRequest } from "@/data/auth/sign-in";\nimport { useAuthStore } from "@/data/auth/store";\nimport { clearChoice, usePendingSignIn } from "@/data/auth/pending-sign-in";\n' +
      'import { proofsFor, stepUpToken } from "@/data/auth/step-up-store";\nexport type F = ChatApi;\nexport type C = ApiClient;\nexport type R = SignInRequest;\n' +
      "export const x = [useEditMessage, useAnswerAiConsent, useSetPushEnabled, isPushEnabled, devicesOptions, useAuthStore, usePendingSignIn, clearChoice];\n" +
      "export const y = [proofsFor, stepUpToken];";
    expect(await ruleIds(code)).toEqual([]);
  });

  it("a labelled, translated control with a valid role and state is green", async () => {
    const code =
      "export const A = () => {\n  const { t } = useTranslation();\n" +
      '  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: true }} accessibilityLabel={t("chat.send")}>\n' +
      '    <Text>{t("chat.send")}</Text>\n  </Pressable>;\n};';
    expect(await ruleIds(head + code)).toEqual([]);
  });

  it("a labelled spinner is green", async () => {
    const code = 'import { ActivityIndicator } from "react-native";\nexport const A = () => { const { t } = useTranslation(); return <ActivityIndicator accessibilityLabel={t("common.loading")} />; };';
    expect(await ruleIds(head + code)).toEqual([]);
  });

  it("an effect with a block body, or one returning its cleanup function, is green", async () => {
    const code =
      'import { useEffect, useLayoutEffect } from "react";\nexport function useKeep(save: () => Promise<void>, subscribe: () => () => void, stop: () => void) {\n' +
      "  useEffect(() => {\n    void save();\n  }, [save]);\n  useEffect(() => {\n    return subscribe();\n  }, [subscribe]);\n  useLayoutEffect(() => () => stop(), [stop]);\n}";
    expect(await ruleIds(code)).toEqual([]);
  });

  it("a failure handled, reported or only waited on is green", async () => {
    const code =
      'import { bestEffort } from "@/data/report";\nimport { settled } from "@/lib/settled";\nexport const a = (p: Promise<void>) => p.catch(bestEffort("chat", "x", "report"));\nexport const b = (p: Promise<void>) => settled(p);\nexport const c = (p: Promise<void>, onError: () => void) => p.catch(() => onError());';
    expect(await ruleIds(code)).toEqual([]);
  });
});
