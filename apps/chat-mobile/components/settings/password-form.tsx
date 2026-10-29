// Setting the first password, or changing it, on the phone (spec §4.5, §5.2; PUT /me/password). Setting one confirms
// it is you first and says which address it signs in with (Apple's relay address can be copied, since it is not one
// the person types). Changing it takes the current password, unless the account confirms with its second factor
// alone, then the proof sheet asks; a token held from a proof a moment ago proves it either way. A change signs every
// other device out, said before it is made. Each refusal is said under the field it is about, which is focused.
// It is a Settings screen: the header with its title and back, as the account's other screens, over the sign-in
// screens' keyboard column. The account's address sits above the new password as a read-only username field, so
// iOS Password AutoFill and Credential Manager know which saved password the new one replaces. While the save runs,
// back waits (the header's, the edge swipe, Android's), and an answer that lands once the screen is no longer in
// front says what happened without moving anyone.
import { useQuery } from "@tanstack/react-query";
import { readSignInFailure, sentenceValues, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { PASSWORD_MIN } from "@uniwork/core/auth/sign-in-form";
import { isAppleRelayEmail } from "@uniwork/core/auth/sign-in-rules";
import * as Clipboard from "expo-clipboard";
import { router, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AuthField, PasswordField } from "@/components/auth/auth-field";
import { FormAlert, KeyboardColumn, SubmitButton, TextButton } from "@/components/auth/auth-layout";
import { useStepBack } from "@/components/auth/use-step-back";
import { ChatHeader } from "@/components/chat/chat-header";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { stepUpToken } from "@/data/auth/step-up-store";
import { useSetPassword } from "@/data/mutations/sign-in-methods";
import { signInMethodsOptions } from "@/data/queries/sign-in";
import { toast } from "@/data/stores/toast-store";
import { confirmsWithSecondFactor } from "@/lib/sign-in-methods";
import { useStepUp } from "./use-step-up";

const P = "settings.security.signInMethods.password";

/** Android's back while the save runs: taken, and nothing done. */
const holdBack = () => undefined;

type Field = "current" | "next" | "again";
interface Problem {
  field: Field | "form";
  message: string;
}

export function PasswordForm() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const methods = useQuery(signInMethodsOptions()).data;
  const stepUp = useStepUp();
  const save = useSetPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  // Back waits for the answer: leaving mid-save would let the answer go back a second time.
  useStepBack(busy, holdBack);
  const fields = { current: useRef<TextInput>(null), next: useRef<TextInput>(null), again: useRef<TextInput>(null) };
  const email = user?.email ?? "";
  const change = methods ? methods.password.set : Boolean(user?.has_password);
  // With a second factor on, the server takes that factor alone as the proof (the sheet asks for it).
  const secondFactor = confirmsWithSecondFactor(methods, Boolean(user?.mfa_enabled_at));
  const asksCurrent = change && !secondFactor;
  // The server's word too: it knows a relay domain this build may not yet.
  const relay = isAppleRelayEmail(email) || Boolean(methods?.account_email_is_relay);

  /** This screen is the one in front (an answer may land after a notification opened another). */
  const inFront = () => mounted.current && navigation.isFocused();

  const refuse = (field: Field | "form", message: string) => {
    setProblem({ field, message });
    if (!inFront()) return;
    haptics.failure();
    if (field !== "form") fields[field].current?.focus();
  };

  const failed = (failure: SignInFailure) => {
    // A wrong current password, or a new one the server would not take, is said under its own field.
    const field = failure.code === "password_incorrect" && asksCurrent ? "current" : failure.code === "invalid_request" ? "next" : "form";
    if (field === "current") setCurrent("");
    refuse(field, t(failure.key, sentenceValues(failure, t)));
  };

  /** Back to Settings; opened on its own (nothing to go back to), to the start screen. */
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const finish = () => {
    toast.success(t(change ? `${P}.toastChanged` : `${P}.toastSet`));
    if (inFront()) leave();
  };

  const submit = async () => {
    if (busy || !user) return;
    setProblem(null);
    if (asksCurrent && !current) return refuse("current", t(`${P}.currentRequired`));
    if (next.length < PASSWORD_MIN) return refuse("next", t(`${P}.tooShort`));
    if (again !== next) return refuse("again", t(`${P}.mismatch`));
    setBusy(true);
    try {
      let proofs: readonly unknown[] | null | undefined = methods?.proofs;
      if (asksCurrent) {
        try {
          await save.mutateAsync({
            newPassword: next,
            currentPassword: current,
            stepUpToken: stepUpToken("change_password", user.id) ?? undefined,
          });
          return finish();
        } catch (error: unknown) {
          const failure = readSignInFailure(error, "password");
          // The server wants another proof now (a second factor turned on elsewhere): the sheet asks for it.
          if (failure.kind !== "step_up") return failed(failure);
          proofs = failure.proofs;
        }
      }
      const result = await stepUp.run(
        change ? "change_password" : "set_password",
        (token) => save.mutateAsync({ newPassword: next, stepUpToken: token }),
        { proofs },
      );
      if (result.done) finish();
    } catch (error: unknown) {
      failed(readSignInFailure(error, "password"));
    } finally {
      setBusy(false);
    }
  };

  const copyEmail = async () => {
    await Clipboard.setStringAsync(email);
    toast.success(t(`${P}.emailCopied`));
  };

  const edit = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    if (problem?.field === field || problem?.field === "form") setProblem(null);
  };
  const errorOf = (field: Field) => (problem?.field === field ? problem.message : null);

  return (
    <View className="flex-1 bg-background" testID="password-screen">
      <ChatHeader title={t(change ? `${P}.changeTitle` : `${P}.setTitle`)} flat onBack={leave} backDisabled={busy} />
      <KeyboardColumn className="pt-4">
        <View className="gap-6" testID="password-form">
          {change ? null : (
            <Text className="text-body leading-6 text-muted-foreground">
              {relay ? t(`${P}.setDescriptionRelay`) : t(`${P}.setDescription`, { email })}
            </Text>
          )}
          <View className="gap-4">
            {/* The account the password belongs to, for the system's saved passwords; Apple's relay address can be copied. */}
            <AuthField
              label={t("auth.email")}
              value={email}
              readOnly
              textContentType="username"
              autoComplete="username"
              autoCapitalize="none"
              trailing={relay ? <TextButton label={t(`${P}.copyEmail`)} onPress={() => void copyEmail()} testID="password-copy-email" /> : null}
              testID="password-username"
            />
            {asksCurrent ? (
              <PasswordField
                ref={fields.current}
                label={t(`${P}.current`)}
                value={current}
                onChangeText={edit("current", setCurrent)}
                error={errorOf("current")}
                busy={busy}
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => fields.next.current?.focus()}
                testID="password-current"
              />
            ) : null}
            <PasswordField
              create
              ref={fields.next}
              label={t(`${P}.new`)}
              value={next}
              onChangeText={edit("next", setNext)}
              error={errorOf("next")}
              hint={t(`${P}.hint`, { min: PASSWORD_MIN })}
              busy={busy}
              autoFocus={!asksCurrent}
              returnKeyType="next"
              onSubmitEditing={() => fields.again.current?.focus()}
              testID="password-new"
            />
            <PasswordField
              create
              ref={fields.again}
              label={t(`${P}.confirm`)}
              value={again}
              onChangeText={edit("again", setAgain)}
              error={errorOf("again")}
              busy={busy}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              testID="password-again"
            />
          </View>
          {change ? (
            <Text className="text-footnote leading-[18px] text-muted-foreground" testID="password-signs-out">
              {t(`${P}.signsOutOthers`)}
            </Text>
          ) : null}
          <FormAlert message={problem?.field === "form" ? problem.message : null} testID="password-error" />
          <SubmitButton label={t(`${P}.save`)} busyLabel={t(`${P}.saving`)} busy={busy} onPress={() => void submit()} testID="password-save" />
        </View>
      </KeyboardColumn>
      <SafeAreaView edges={["bottom"]} />
      {stepUp.sheet}
    </View>
  );
}
