// Setting the first password, or changing it, on the phone (spec §4.5, §5.2; PUT /me/password). Setting one confirms
// it is you first and says which address it signs in with (Apple's relay address can be copied, since it is not one
// the person types). Changing it takes the current password, unless the account confirms with its second factor
// alone, then the proof sheet asks; a token held from a proof a moment ago proves it either way. A change signs every
// other device out, said before it is made. Each refusal is said under the field it is about, which is focused.
import { useQuery } from "@tanstack/react-query";
import { readSignInFailure, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TextInput, View } from "react-native";
import { PasswordField } from "@/components/auth/auth-field";
import { AuthHeading, FormAlert, SubmitButton, TextButton } from "@/components/auth/auth-layout";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { stepUpToken } from "@/data/auth/step-up-store";
import { useSetPassword } from "@/data/mutations/sign-in-methods";
import { signInMethodsOptions } from "@/data/queries/sign-in";
import { toast } from "@/data/stores/toast-store";
import { isAppleRelayAddress } from "@/lib/apple-relay";
import { PASSWORD_MIN } from "@/lib/sign-in-form";
import { confirmsWithSecondFactor } from "@/lib/sign-in-methods";
import { useStepUp } from "./use-step-up";

const P = "settings.security.signInMethods.password";

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
  const fields = { current: useRef<TextInput>(null), next: useRef<TextInput>(null), again: useRef<TextInput>(null) };
  const email = user?.email ?? "";
  const change = methods ? methods.password.set : Boolean(user?.has_password);
  // With a second factor on, the server takes that factor alone as the proof (the sheet asks for it).
  const secondFactor = confirmsWithSecondFactor(methods, Boolean(user?.mfa_enabled_at));
  const asksCurrent = change && !secondFactor;
  const relay = isAppleRelayAddress(email);

  const refuse = (field: Field | "form", message: string) => {
    setProblem({ field, message });
    haptics.failure();
    if (field !== "form") fields[field].current?.focus();
  };

  const failed = (failure: SignInFailure) => {
    // A wrong current password, or a new one the server would not take, is said under its own field.
    const field = failure.code === "password_incorrect" && asksCurrent ? "current" : failure.code === "invalid_request" ? "next" : "form";
    if (field === "current") setCurrent("");
    refuse(field, t(failure.key, failure.values));
  };

  const finish = () => {
    toast.success(t(change ? `${P}.toastChanged` : `${P}.toastSet`));
    if (router.canGoBack()) router.back();
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
    <View className="gap-6" testID="password-form">
      <AuthHeading
        title={t(change ? `${P}.changeTitle` : `${P}.setTitle`)}
        subtitle={change ? null : relay ? t(`${P}.setDescriptionRelay`) : t(`${P}.setDescription`, { email })}
      />
      {!change && relay ? (
        <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-2">
          <Text selectable className="flex-1 text-callout text-foreground">
            {email}
          </Text>
          <TextButton label={t(`${P}.copyEmail`)} onPress={() => void copyEmail()} testID="password-copy-email" />
        </View>
      ) : null}
      <View className="gap-4">
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
      {stepUp.sheet}
    </View>
  );
}
