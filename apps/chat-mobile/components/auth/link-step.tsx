// "Tôi đã có tài khoản", once signed in (spec §4.3 step=link, §5.2): never written on open, the screen asks whether
// to link the Google or Apple identity the choice screen holds into the account just signed in to. Linked, it says
// so (a status, the reader's focus on "Tiếp tục"); an identity on an empty account of its own asks to move it; one
// another account holds says whose (masked) and that it is unlinked there first. Whatever happens, "Tiếp tục" goes
// on into the app; a choice that is gone counts as done.
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import type { SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { clearChoice, usePendingSignIn } from "@/data/auth/pending-sign-in";
import { useAuthStore } from "@/data/auth/store";
import { useLinkPendingTicket } from "@/data/mutations/sign-in";
import { signInFailureOf } from "@/lib/sign-in-failure";
import { AuthHeading, FormAlert, SubmitButton, TextButton } from "./auth-layout";
import { IdentityCard } from "./choice-parts";
import { useReaderFocus } from "./use-reader-focus";

type LinkState =
  | { kind: "ask" }
  | { kind: "linked"; provider: SignInProvider }
  | { kind: "move"; failure: SignInFailure }
  | { kind: "failed"; failure: SignInFailure };

const enter = () => router.replace("/");

export function LinkStep() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const accountEmail = useAuthStore((s) => s.user?.email ?? "");
  const choice = usePendingSignIn((s) => s.choice);
  const link = useLinkPendingTicket();
  const [state, setState] = useState<LinkState>({ kind: "ask" });
  const linkedLine =
    state.kind === "linked" ? t("auth.continue.link.done", { provider: t(`auth.social.provider.${state.provider}`) }) : null;
  useAnnounce(linkedLine);
  const continueRef = useReaderFocus(state.kind !== "ask" || !choice);

  const run = async (move: boolean) => {
    const provider = choice?.identity.provider;
    if (!userId || !provider || link.isPending) return;
    try {
      await link.mutateAsync({ userId, move });
      setState({ kind: "linked", provider });
    } catch (error: unknown) {
      const failure = signInFailureOf(error, "ticket");
      if (failure.kind === "restart") clearChoice();
      setState(failure.kind === "move" ? { kind: "move", failure } : { kind: "failed", failure });
    }
  };

  const continueButton = <SubmitButton ref={continueRef} label={t("auth.continue.link.continue")} onPress={enter} testID="link-continue" />;

  if (state.kind === "linked") {
    return (
      <View className="gap-6" testID="link-done">
        <AuthHeading title={t("auth.continue.link.title", { provider: t(`auth.social.provider.${state.provider}`) })} />
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" className="text-body leading-6 text-foreground" testID="link-done-status">
          {linkedLine}
        </Text>
        {continueButton}
      </View>
    );
  }
  if (!choice || (state.kind === "failed" && state.failure.kind === "restart")) {
    return (
      <View className="gap-6" testID="link-nothing">
        <AuthHeading title={t("auth.continue.link.nothingLeft")} />
        {continueButton}
      </View>
    );
  }

  const { identity } = choice;
  const provider = t(`auth.social.provider.${identity.provider}`);
  const decline = () => {
    clearChoice();
    enter();
  };

  if (state.kind === "move") {
    const masked = state.failure.maskedEmail;
    return (
      <View className="gap-6" testID="link-move">
        <AuthHeading
          title={t("auth.continue.link.movableTitle", { provider })}
          subtitle={masked ? t("auth.continue.link.movable", { provider, masked }) : t("auth.continue.link.movableUnknown", { provider })}
        />
        <Text className="text-callout leading-5 text-muted-foreground">{t("auth.continue.link.movableNote")}</Text>
        <SubmitButton
          label={t("auth.continue.link.move")}
          busyLabel={t("auth.continue.link.moving")}
          busy={link.isPending}
          onPress={() => void run(true)}
          testID="link-move-confirm"
        />
        <View className="items-center">
          <TextButton label={t("auth.continue.link.decline")} tone="muted" disabled={link.isPending} onPress={decline} testID="link-decline" />
        </View>
      </View>
    );
  }

  const failure = state.kind === "failed" ? state.failure : null;
  const taken = failure?.code === "sign_in_method_taken";
  const failureLine = !failure
    ? null
    : taken
      ? failure.maskedEmail
        ? t("auth.continue.link.taken", { provider, masked: failure.maskedEmail })
        : t("auth.continue.link.takenUnknown", { provider })
      : t(failure.key, failure.values);

  return (
    <View className="gap-6" testID="link-ask">
      <AuthHeading
        title={t("auth.continue.link.title", { provider })}
        subtitle={
          identity.private_relay
            ? t("auth.continue.link.questionRelay", { provider, accountEmail })
            : t("auth.continue.link.question", { provider, providerEmail: identity.email, accountEmail })
        }
      />
      <IdentityCard identity={identity} />
      <Text className="text-callout leading-5 text-muted-foreground">{t("auth.continue.link.body", { provider })}</Text>
      <FormAlert message={failureLine} testID="link-failure" />
      {failure ? (
        continueButton
      ) : (
        <>
          <SubmitButton
            label={t("auth.continue.link.confirm")}
            busyLabel={t("auth.continue.link.linking")}
            busy={link.isPending}
            onPress={() => void run(false)}
            testID="link-confirm"
          />
          <View className="items-center">
            <TextButton label={t("auth.continue.link.decline")} tone="muted" disabled={link.isPending} onPress={decline} testID="link-decline" />
          </View>
        </>
      )}
    </View>
  );
}
