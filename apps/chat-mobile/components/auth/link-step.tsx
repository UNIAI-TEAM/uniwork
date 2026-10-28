// "Tôi đã có tài khoản", once signed in (spec §4.3 step=link, §5.2): never written on open, the screen asks whether
// to link the Google or Apple identity the choice screen holds into the account just signed in to. Linked, it says
// so (a status the reader's focus moves to, with "Tiếp tục" next: VoiceOver would cut a status announced beside a
// focus move off, so the focus is what says it); a refusal moves the focus to its line the same way; an identity on
// an empty account of its own asks to move it; one
// another account holds says whose (masked) and that it is unlinked there first. A session that signed in before the
// ticket was issued (or a move) is asked to confirm it is you first, then the link goes on (use-step-up.ts). Whatever
// happens, "Tiếp tục" goes on into the app; a choice that is gone counts as done.
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import type { SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { linkAction } from "@uniwork/core/auth/step-up";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useStepUp } from "@/components/settings/use-step-up";
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
  const stepUp = useStepUp();
  const [state, setState] = useState<LinkState>({ kind: "ask" });
  const linkedLine =
    state.kind === "linked" ? t("auth.continue.link.done", { provider: t(`auth.social.provider.${state.provider}`) }) : null;
  // The reader lands on what changed: the status, a refusal, or the way on when there is nothing left to link.
  const restart = state.kind === "failed" && state.failure.kind === "restart";
  const statusRef = useReaderFocus(state.kind === "linked");
  const failureRef = useReaderFocus(state.kind === "failed" && !restart && choice !== null);
  const continueRef = useReaderFocus(state.kind !== "linked" && (!choice || restart));

  const run = async (move: boolean) => {
    const provider = choice?.identity.provider;
    if (!userId || !provider || link.isPending) return;
    const attempt = () => link.mutateAsync({ userId, move });
    try {
      try {
        await attempt();
      } catch (error: unknown) {
        // This session signed in before the ticket was issued, or the identity moves: confirm it is you, then link.
        const first = signInFailureOf(error, "ticket");
        if (first.kind !== "step_up") throw error;
        const proved = await stepUp.run(linkAction(provider), attempt, { proofs: first.proofs });
        if (!proved.done) return;
      }
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
        <View ref={statusRef} accessible accessibilityRole="text" testID="link-done-status">
          <Text className="text-body leading-6 text-foreground">{linkedLine}</Text>
        </View>
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
        {stepUp.sheet}
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
      <FormAlert ref={failureRef} announce={false} message={failureLine} testID="link-failure" />
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
      {stepUp.sheet}
    </View>
  );
}
