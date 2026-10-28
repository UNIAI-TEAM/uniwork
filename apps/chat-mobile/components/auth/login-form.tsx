// Email and password on the sign-in screen (spec §5.2): the fields the system's password AutoFill and Credential
// Manager fill (username + password, webcredentials:app.uniworkos.com), "Quên mật khẩu?" opening the web's reset
// page in the browser, the failure line and the primary button at the thumb. A field the form can judge itself
// (empty, not an address) is said under it and focused before any round trip; a wrong password is cleared and its
// field focused again, the address kept.
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { useOpenWebPage } from "@/components/settings/use-open-web-page";
import { emailError, passwordError, type FieldError } from "@/lib/sign-in-form";
import { AuthField, PasswordField } from "./auth-field";
import { FormAlert, SubmitButton, TextButton } from "./auth-layout";
import type { SignInResult } from "./use-sign-in";

interface Props {
  /** the control a sign-in runs from, "password" when it is this form */
  busy: string | null;
  /** the line that says what failed, from the screen's sign-in */
  message: string | null;
  /** that line as a screen reader hears it while it counts down (useFailureMessage › spoken) */
  spoken?: string | null;
  /** a lock is counting down: the form waits */
  waiting?: boolean;
  onSubmit: (email: string, password: string) => Promise<SignInResult | null>;
}

export function LoginForm({ busy, message, spoken = null, waiting = false, onSubmit }: Props) {
  const { t } = useTranslation();
  const openWebPage = useOpenWebPage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: FieldError | null; password?: FieldError | null }>({});
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const idle = busy === null;

  const submit = async () => {
    if (!idle || waiting) return;
    const found = { email: emailError(email), password: passwordError(password) };
    setErrors(found);
    if (found.email || found.password) {
      (found.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    const result = await onSubmit(email, password);
    if (result && !result.ok && result.failure.kind === "field") {
      setPassword("");
      passwordInput.current?.focus();
    }
  };

  const say = (error: FieldError | null | undefined) => (error ? t(error.key, error.values) : null);

  return (
    <View className="gap-4">
      <AuthField
        ref={emailInput}
        label={t("auth.email")}
        value={email}
        onChangeText={(next) => {
          setEmail(next);
          setErrors((current) => ({ ...current, email: null }));
        }}
        error={say(errors.email)}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        autoCapitalize="none"
        returnKeyType="next"
        onSubmitEditing={() => passwordInput.current?.focus()}
        busy={!idle}
        testID="login-email"
      />
      <View className="gap-1">
        <PasswordField
          ref={passwordInput}
          label={t("auth.password")}
          value={password}
          onChangeText={(next) => {
            setPassword(next);
            setErrors((current) => ({ ...current, password: null }));
          }}
          error={say(errors.password)}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          busy={!idle}
          testID="login-password"
        />
        <View className="flex-row justify-end">
          <TextButton
            label={t("auth.forgotPassword")}
            disabled={!idle}
            onPress={() => openWebPage(`${runtimeConfig().appUrl}${paths.forgotPassword()}`)}
            testID="login-forgot"
          />
        </View>
      </View>
      <FormAlert message={message} spoken={spoken} testID="login-failure" />
      <SubmitButton
        label={t("auth.login")}
        busyLabel={t("auth.signingIn")}
        busy={busy === "password"}
        disabled={(!idle && busy !== "password") || waiting}
        onPress={() => void submit()}
        testID="login-button"
      />
    </View>
  );
}
