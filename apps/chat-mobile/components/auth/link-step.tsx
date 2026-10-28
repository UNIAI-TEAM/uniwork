// "Tôi đã có tài khoản", once signed in (spec §4.3 step=link, §5.2): never written on open, the screen asks whether
// to link the Google or Apple identity the choice screen holds into the account just signed in to. Linked, it says
// so (a status the reader's focus moves to, with "Tiếp tục" next: VoiceOver would cut a status announced beside a
// focus move off, so the focus is what says it); a refusal moves the focus to its line the same way; an identity on
// an empty account of its own asks to move it; one another account holds says whose (masked) and that it is unlinked
// there first. A failure that pressing again can mend (the connection, the server, a wait, a proof refused) keeps
// "Liên kết", or the move's "Chuyển sang đây", held while a wait counts down; one it cannot leaves "Tiếp tục" alone,
// as on the web. A session that signed in before the ticket was issued (or a move) is asked to confirm it is you
// first, then the link goes on (use-step-up.ts). Whatever happens, "Tiếp tục" goes on into the app and drops the
// choice; a choice that is gone counts as done.
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
import { shownFailure, useFailureMessage, type ShownFailure } from "./use-sign-in";
import { useReaderFocus } from "./use-reader-focus";

type LinkState = { kind: "ask" } | { kind: "linked"; provider: SignInProvider } | { kind: "move"; masked: string | null };

/**
 * Failures after which pressing "Liên kết" again cannot help: the identity belongs to an account with content, the
 * account already has another one of this provider, its own address is not verified yet, or the session ended.
 */
const FINAL = new Set(["sign_in_method_taken", "sign_in_method_already_linked", "email_unverified"]);
const isFinal = (failure: SignInFailure) => failure.kind === "session" || FINAL.has(failure.code);

/** The link step names the provider and the holder in its own words (spec §4.3) where the table's is Settings'. */
function linkFailure(failure: SignInFailure, provider: SignInProvider): SignInFailure {
  if (failure.code !== "sign_in_method_taken") return failure;
  return { ...failure, provider, key: failure.maskedEmail ? "auth.continue.link.taken" : "auth.continue.link.takenUnknown" };
}

/** Into the app, past whatever is left of the choice: a ticket not linked is dropped on the server too. */
function leave(): void {
  useAuthStore.getState().dropChoice();
  router.replace("/");
}

export function LinkStep() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const accountEmail = useAuthStore((s) => s.user?.email ?? "");
  const choice = usePendingSignIn((s) => s.choice);
  const link = useLinkPendingTicket();
  const stepUp = useStepUp();
  const [state, setState] = useState<LinkState>({ kind: "ask" });
  const [shown, setShown] = useState<ShownFailure | null>(null);
  const said = useFailureMessage(shown);
  // A wait that is over is no failure any more: the question is as it was.
  const failure = shown && said.message ? shown.failure : null;
  const final = failure !== null && isFinal(failure);
  // The reader lands on what changed: the status, a refusal, or the way on when there is nothing left to link.
  const statusRef = useReaderFocus(state.kind === "linked");
  const failureRef = useReaderFocus(failure !== null && choice !== null);
  const continueRef = useReaderFocus(state.kind !== "linked" && !choice);

  const run = async (move: boolean) => {
    const provider = choice?.identity.provider;
    if (!userId || !provider || link.isPending || said.waiting) return;
    const masked = state.kind === "move" ? state.masked : null;
    setShown(null);
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
      const read = signInFailureOf(error, "ticket");
      // The ticket is gone: nothing is left to link, and the screen says so.
      if (read.kind === "restart") {
        clearChoice();
        return;
      }
      if (read.kind === "move" && !move) {
        setState({ kind: "move", masked: read.maskedEmail });
        return;
      }
      // A move that failed on the way (offline, a 5xx, a wait) is still the decision being made: the question stays,
      // and its button sends the move again instead of a link that would only ask it again.
      setState(move && !isFinal(read) ? { kind: "move", masked } : { kind: "ask" });
      setShown(shownFailure(linkFailure(read, provider)));
    }
  };

  const continueButton = (
    <SubmitButton ref={continueRef} label={t("auth.continue.link.continue")} onPress={leave} testID="link-continue" />
  );

  if (state.kind === "linked") {
    const provider = t(`auth.social.provider.${state.provider}`);
    return (
      <View className="gap-6" testID="link-done">
        <AuthHeading title={t("auth.continue.link.title", { provider })} />
        <View ref={statusRef} accessible accessibilityRole="text" testID="link-done-status">
          <Text className="text-body leading-6 text-foreground">{t("auth.continue.link.done", { provider })}</Text>
        </View>
        {continueButton}
      </View>
    );
  }
  if (!choice) {
    return (
      <View className="gap-6" testID="link-nothing">
        <AuthHeading title={t("auth.continue.link.nothingLeftTitle")} subtitle={t("auth.continue.link.nothingLeft")} />
        {continueButton}
      </View>
    );
  }

  const { identity } = choice;
  const provider = t(`auth.social.provider.${identity.provider}`);
  const failureLine = (
    <FormAlert ref={failureRef} announce={false} message={said.message} spoken={said.spoken} testID="link-failure" />
  );
  // Past a failure the way out reads "Tiếp tục": the question is no longer the one being answered.
  const declineLabel = failure ? t("auth.continue.link.continue") : t("auth.continue.link.decline");

  if (state.kind === "move") {
    return (
      <View className="gap-6" testID="link-move">
        <AuthHeading
          title={t("auth.continue.link.movableTitle", { provider })}
          subtitle={
            state.masked
              ? t("auth.continue.link.movable", { provider, masked: state.masked })
              : t("auth.continue.link.movableUnknown", { provider })
          }
        />
        <Text className="text-callout leading-5 text-muted-foreground">{t("auth.continue.link.movableNote")}</Text>
        {failureLine}
        <SubmitButton
          label={t("auth.continue.link.move")}
          busyLabel={t("auth.continue.link.moving")}
          busy={link.isPending}
          disabled={said.waiting}
          onPress={() => void run(true)}
          testID="link-move-confirm"
        />
        <View className="items-center">
          {/* The move's pair is Settings' own ("Chuyển sang đây" / "Không chuyển"): one decision, one wording. */}
          <TextButton label={t("auth.continue.link.moveDecline")} tone="muted" disabled={link.isPending} onPress={leave} testID="link-decline" />
        </View>
        {stepUp.sheet}
      </View>
    );
  }

  return (
    <View className="gap-6" testID="link-ask">
      <AuthHeading
        title={t("auth.continue.link.title", { provider })}
        subtitle={
          final
            ? t("auth.continue.link.notLinked", { provider, accountEmail })
            : identity.private_relay
              ? t("auth.continue.link.questionRelay", { provider, accountEmail })
              : t("auth.continue.link.question", { provider, providerEmail: identity.email, accountEmail })
        }
      />
      <IdentityCard identity={identity} />
      {failure ? null : <Text className="text-callout leading-5 text-muted-foreground">{t("auth.continue.link.body", { provider })}</Text>}
      {failureLine}
      {final ? (
        continueButton
      ) : (
        <>
          <SubmitButton
            label={t("auth.continue.link.confirm")}
            busyLabel={t("auth.continue.link.linking")}
            busy={link.isPending}
            disabled={said.waiting}
            onPress={() => void run(false)}
            testID="link-confirm"
          />
          <View className="items-center">
            <TextButton label={declineLabel} tone="muted" disabled={link.isPending} onPress={leave} testID="link-decline" />
          </View>
        </>
      )}
      {stepUp.sheet}
    </View>
  );
}
