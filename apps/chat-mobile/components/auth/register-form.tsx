// A new account by email on the register screen (spec §5.2): the name colleagues see, the address, and a new
// password the system offers to generate and save (newPassword, the server's rules as passwordRules). Each field
// the form can judge is said under it and focused first; an address that already has an account is said there too.
// Signed in, the entry sends the account to prove its address (app/(app)/verify-email.tsx).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { PASSWORD_MIN, displayNameError, emailError, passwordError, type FieldError } from "@/lib/sign-in-form";
import { AuthField, PasswordField } from "./auth-field";
import { FormAlert, SubmitButton } from "./auth-layout";
import type { SignInResult } from "./use-sign-in";

type Field = "name" | "email" | "password";

interface Props {
  busy: string | null;
  message: string | null;
  /** that line as a screen reader hears it while it counts down (useFailureMessage › spoken) */
  spoken?: string | null;
  waiting?: boolean;
  onSubmit: (input: { displayName: string; email: string; password: string }) => Promise<SignInResult | null>;
}

export function RegisterForm({ busy, message, spoken = null, waiting = false, onSubmit }: Props) {
  const { t } = useTranslation();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, FieldError | null>>>({});
  const inputs = { name: useRef<TextInput>(null), email: useRef<TextInput>(null), password: useRef<TextInput>(null) };
  const idle = busy === null;

  const submit = async () => {
    if (!idle || waiting) return;
    const found = { name: displayNameError(displayName), email: emailError(email), password: passwordError(password, true) };
    setErrors(found);
    const first = (["name", "email", "password"] as const).find((field) => found[field]);
    if (first) {
      inputs[first].current?.focus();
      return;
    }
    const result = await onSubmit({ displayName, email, password });
    // The address has an account (conflict), or the server judged the address or the password: the address first.
    if (result && !result.ok && result.failure.kind === "field") inputs.email.current?.focus();
  };

  const edit = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((current) => ({ ...current, [field]: null }));
  };
  const say = (error: FieldError | null | undefined) => (error ? t(error.key, error.values) : null);

  return (
    <View className="gap-4">
      <AuthField
        ref={inputs.name}
        label={t("auth.displayName")}
        hint={t("auth.continue.create.displayNameHint")}
        value={displayName}
        onChangeText={edit("name", setDisplayName)}
        error={say(errors.name)}
        textContentType="name"
        autoComplete="name"
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => inputs.email.current?.focus()}
        busy={!idle}
        testID="register-name"
      />
      <AuthField
        ref={inputs.email}
        label={t("auth.email")}
        value={email}
        onChangeText={edit("email", setEmail)}
        error={say(errors.email)}
        placeholder={t("auth.emailPlaceholder")}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        autoCapitalize="none"
        returnKeyType="next"
        onSubmitEditing={() => inputs.password.current?.focus()}
        busy={!idle}
        testID="register-email"
      />
      <PasswordField
        ref={inputs.password}
        create
        label={t("auth.password")}
        hint={t("auth.passwordMinHint", { min: PASSWORD_MIN })}
        value={password}
        onChangeText={edit("password", setPassword)}
        error={say(errors.password)}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
        busy={!idle}
        testID="register-password"
      />
      <FormAlert message={message} spoken={spoken} testID="register-failure" />
      <SubmitButton
        label={t("mobile.sign_in.register.submit")}
        busyLabel={t("auth.registering")}
        busy={busy === "register"}
        disabled={(!idle && busy !== "register") || waiting}
        onPress={() => void submit()}
        testID="register-button"
      />
    </View>
  );
}
