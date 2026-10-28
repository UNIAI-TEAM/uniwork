// The choice screen (spec §4.3 with the app's order, §5.2): a Google or Apple identity no account matched. The
// person names what it is: invited with another (work) address, an account they already have (sign in once, and
// the identity is linked), or a new account (last: the app cannot create an organization). An identity whose
// address has an account that the provider cannot vouch for gets one way: sign in to link. The ticket and its
// nonce stay in memory (data/auth/pending-sign-in.ts); a choice that is gone, expired or never held after a
// restart says so with the way back. Leaving the screen without signing in drops the choice, as "Hủy" does.
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput, View } from "react-native";
import { SignInLegalNote } from "@/components/settings/sign-in-legal-note";
import { Text } from "@/components/ui/text";
import { clearChoice, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { displayNameError } from "@/lib/sign-in-form";
import { signInRoutes } from "@/lib/sign-in-routes";
import { AuthField } from "./auth-field";
import { AuthHeading, AuthLayout, FormAlert, SubmitButton, TextButton } from "./auth-layout";
import { ChoiceRow, IdentityCard } from "./choice-parts";
import { ClaimCodeStep, ClaimEmailStep, RESEND_GAP_MS } from "./claim-steps";
import { useFailureMessage, useSignIn } from "./use-sign-in";
import { useStepBack } from "./use-step-back";

type Step = "choices" | "email" | "code";

/** Back to the sign-in screen this sign-in started on. */
function backToSignIn(): void {
  if (router.canGoBack()) router.dismissAll();
  else router.replace(signInRoutes.login());
}

export function ContinueFlow() {
  const { t } = useTranslation();
  const choice = usePendingSignIn((s) => s.choice);
  const [step, setStep] = useState<Step>("choices");
  const [email, setEmail] = useState("");
  const [resendAtMs, setResendAtMs] = useState(0);
  const [gone, setGone] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInput = useRef<TextInput>(null);
  const create = useSignIn("ticket");
  const { message, spoken } = useFailureMessage(create.shown);
  // The provider the screen opened for, to say whose sign-in ran out once the choice itself is gone.
  const [openedFor] = useState(choice?.identity.provider ?? null);

  const stepBack = () => setStep(step === "code" ? "email" : "choices");
  useStepBack(step !== "choices", stepBack);
  // Leaving without signing in is "Hủy" by another name: nothing is left waiting.
  useEffect(
    () => () => {
      if (!useAuthStore.getState().user) clearChoice();
    },
    [],
  );

  const failure = create.shown?.failure;
  if (gone || !choice || failure?.kind === "restart") {
    const provider = choice?.identity.provider ?? openedFor;
    const providerName = provider ? t(`auth.social.provider.${provider}`) : null;
    return (
      <AuthLayout testID="continue-screen" onBack={backToSignIn}>
        <View className="gap-6" testID="continue-expired">
          <AuthHeading
            title={t("auth.continue.expired.title")}
            subtitle={
              providerName ? t("auth.continue.expired.bodyProvider", { provider: providerName }) : t("auth.continue.expired.body")
            }
          />
          <SubmitButton
            label={t("auth.continue.expired.retry")}
            onPress={() => {
              clearChoice();
              backToSignIn();
            }}
            testID="continue-retry"
          />
        </View>
      </AuthLayout>
    );
  }

  const restart = () => setGone(true);
  const { identity } = choice;
  const provider = t(`auth.social.provider.${identity.provider}`);
  const relay = identity.private_relay;
  const needsName = !identity.name.trim();
  const busy = create.busy !== null;
  const toLogin = () => router.push(signInRoutes.login({ link: true }));
  const cancel = () => {
    clearChoice();
    if (router.canGoBack()) router.back();
    else router.replace(signInRoutes.login());
  };

  if (step === "email" || step === "code") {
    return (
      <AuthLayout testID="continue-screen" onBack={stepBack}>
        {step === "email" ? (
          <ClaimEmailStep
            email={email}
            onChangeEmail={setEmail}
            onSent={() => {
              setResendAtMs(Date.now() + RESEND_GAP_MS);
              setStep("code");
            }}
            onRestart={restart}
          />
        ) : (
          <ClaimCodeStep
            email={email.trim()}
            resendAtMs={resendAtMs}
            onResent={() => setResendAtMs(Date.now() + RESEND_GAP_MS)}
            onChangeEmail={() => setStep("email")}
            onRestart={restart}
          />
        )}
      </AuthLayout>
    );
  }

  const createAccount = async () => {
    if (busy) return;
    if (needsName) {
      if (!naming) {
        setNaming(true);
        requestAnimationFrame(() => nameInput.current?.focus());
        return;
      }
      const error = displayNameError(name);
      setNameError(error ? t(error.key, error.values) : null);
      if (error) {
        nameInput.current?.focus();
        return;
      }
    }
    await create.run({ method: "ticket", ...(needsName ? { displayName: name } : {}) }, "create");
  };

  if (choice.ticketKind === "link_required") {
    return (
      <AuthLayout testID="continue-screen" onBack={cancel}>
        <AuthHeading
          title={t("auth.continue.linkRequired.title")}
          subtitle={
            relay
              ? t("auth.continue.linkRequired.bodyRelay", { provider })
              : t("auth.continue.linkRequired.body", { email: identity.email, provider })
          }
        />
        <IdentityCard identity={identity} />
        <SubmitButton label={t("auth.continue.linkRequired.action")} onPress={toLogin} testID="continue-link-required" />
        <View className="items-center">
          <TextButton label={t("auth.continue.cancel")} tone="muted" onPress={cancel} testID="continue-cancel" />
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout testID="continue-screen" onBack={cancel}>
      <AuthHeading title={t("auth.continue.title", { provider })} subtitle={t("auth.continue.description", { provider })} />
      <IdentityCard identity={identity} />
      {relay ? <Text className="text-footnote leading-[18px] text-muted-foreground">{t("auth.continue.relayHint")}</Text> : null}
      <View className="gap-3">
        <Text accessibilityRole="header" className="text-footnote font-semibold uppercase tracking-wide text-muted-foreground">
          {t("auth.continue.choicesLabel")}
        </Text>
        <ChoiceRow
          icon="mail-outline"
          title={t("auth.continue.invited.title")}
          body={t("auth.continue.invited.body")}
          disabled={busy}
          onPress={() => setStep("email")}
          testID="choice-invited"
        />
        <ChoiceRow
          icon="log-in-outline"
          title={t("auth.continue.existing.title")}
          body={t("auth.continue.existing.body", { provider })}
          disabled={busy}
          onPress={toLogin}
          testID="choice-existing"
        />
        <ChoiceRow
          icon="person-add-outline"
          title={t("auth.continue.create.title")}
          body={relay ? t("auth.continue.create.bodyRelay") : t("auth.continue.create.body", { email: identity.email })}
          busy={create.busy === "create" && !naming}
          busyLabel={t("auth.continue.create.submitting")}
          onPress={() => void createAccount()}
          testID="choice-create"
        >
          {naming ? (
            <>
              <AuthField
                ref={nameInput}
                label={t("auth.continue.create.displayNameLabel")}
                hint={t("auth.continue.create.displayNameHint")}
                error={nameError}
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  setNameError(null);
                }}
                textContentType="name"
                autoComplete="name"
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={() => void createAccount()}
                busy={busy}
                testID="choice-name"
              />
              <SubmitButton
                label={t("auth.continue.create.submit")}
                busyLabel={t("auth.continue.create.submitting")}
                busy={create.busy === "create"}
                onPress={() => void createAccount()}
                testID="choice-create-submit"
              />
            </>
          ) : null}
        </ChoiceRow>
        <SignInLegalNote />
      </View>
      <FormAlert message={message} spoken={spoken} testID="continue-failure" />
      {failure?.code === "sign_in_account_conflict" ? (
        <SubmitButton label={t("auth.continue.linkRequired.action")} variant="outline" onPress={toLogin} testID="continue-conflict" />
      ) : failure?.kind === "form" ? (
        <SubmitButton
          label={t("common.retry")}
          variant="outline"
          disabled={busy}
          onPress={() => void createAccount()}
          testID="continue-retry-create"
        />
      ) : null}
      <View className="items-center">
        <TextButton label={t("auth.continue.cancel")} tone="muted" disabled={busy} onPress={cancel} testID="continue-cancel" />
      </View>
    </AuthLayout>
  );
}
