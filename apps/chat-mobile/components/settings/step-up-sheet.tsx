// "Xác nhận là bạn" on the phone (ADR 0049 §5, spec §4.5, §5.2): the one sheet every command that changes how the
// account signs in, or that its owner cannot undo alone, opens before it runs (use-step-up.ts). It asks for the proof
// the server's list puts first on this phone (core's proofChoice through data/auth/step-up-store.ts › proofsFor:
// the second factor alone while it is on, else the password, Apple's or Google's own sheet, a mailed code), with
// "Dùng cách khác" for the rest. A passing proof buys a ten-minute token held in memory, and the sheet closes on it;
// a refusal is said under the field, which is cleared and focused; a lock counts down. A server that now asks for
// another proof (two-factor turned on elsewhere) changes the list in place. What the person chose and when a code was
// mailed live in the ask (use-step-up.ts), not here: the sheet the app lock put away comes back on the same proof.
import { useQuery } from "@tanstack/react-query";
import type { StepUpAction, StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, type TextInput, View } from "react-native";
import { TextButton } from "@/components/auth/auth-layout";
import { shownFailure, useFailureMessage, type ShownFailure } from "@/components/auth/use-sign-in";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { proofsFor } from "@/data/auth/step-up-store";
import { appLockState } from "@/data/stores/app-lock-store";
import { useSendStepUpCode, useStepUpProof, type ProofEntry } from "@/data/mutations/sign-in-methods";
import { signInOfferOptions } from "@/data/queries/sign-in";
import { isAppleRelayAddress } from "@/lib/apple-relay";
import { signInFailureOf } from "@/lib/sign-in-failure";
import { EmailCodeProof, PasswordProof, ProviderProof, SecondFactorProof } from "./step-up-proofs";
import { useOpenWebPage } from "./use-open-web-page";

/** One request for a proof: the command it is for, and what the person did in the sheet so far. */
export interface StepUpAsk {
  id: number;
  action: StepUpAction;
  /** the server's freshest list of what it takes; a refusal that names others replaces it */
  proofs: readonly unknown[];
  /** the proof chosen with "Dùng cách khác" (null: the list's first) */
  picked: StepUpProof | null;
  /** when a code was mailed for this action, within its ten minutes: the sheet waits on the code's field */
  mailedAt: number | null;
}

export type StepUpProgress = Partial<Pick<StepUpAsk, "proofs" | "picked" | "mailedAt">>;

interface SheetProps {
  /** the ask drawn: the one presented, kept while the sheet slides away */
  ask: StepUpAsk | null;
  visible: boolean;
  /** inside another sheet, the app lock's close is an answer (the ask ends); else the gate puts the sheet away */
  lockAnswers: boolean;
  onDone: (held: boolean) => void;
  onProgress: (ask: StepUpAsk, patch: StepUpProgress) => void;
  /** iOS: the sheet finished closing, so another may be presented */
  onDismiss: () => void;
}

export function StepUpSheet({ ask, visible, lockAnswers, onDone, onProgress, onDismiss }: SheetProps) {
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        // The lock took the sheet away, not the person: the ask waits under it (use-step-up.ts › away).
        if (!lockAnswers && appLockState.getState().engaged) return;
        if (!busy) onDone(false);
      }}
      onDismiss={onDismiss}
      dragFrom="handle"
      avoidKeyboard
      keyboardClassName="max-h-[92%]"
      testID="step-up-sheet"
    >
      {ask ? (
        <StepUpBody key={ask.id} ask={ask} onBusy={setBusy} onDone={onDone} onProgress={(patch) => onProgress(ask, patch)} />
      ) : null}
    </BottomSheet>
  );
}

/** The proof's own name, as "Dùng cách khác" lists it. */
const PROOF_LABEL: Record<StepUpProof, string> = {
  password: "settings.security.stepUp.password.label",
  totp: "settings.security.stepUp.totp.label",
  email_code: "settings.security.stepUp.emailCode.label",
  apple: "settings.security.stepUp.provider.apple",
  google: "settings.security.stepUp.provider.google",
};

interface BodyProps {
  ask: StepUpAsk;
  onBusy: (busy: boolean) => void;
  onDone: (held: boolean) => void;
  onProgress: (patch: StepUpProgress) => void;
}

function StepUpBody({ ask, onBusy, onDone, onProgress }: BodyProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const offer = useQuery(signInOfferOptions()).data;
  const openWebPage = useOpenWebPage();
  const step = useStepUpProof();
  const sendCode = useSendStepUpCode();
  const { proofs, picked } = ask;
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState<ShownFailure | null>(null);
  const [refusals, setRefusals] = useState(0);
  const { message, spoken, waiting } = useFailureMessage(failure);
  const field = useRef<TextInput>(null);
  const email = user?.email ?? "";
  const choice = proofsFor({ proofs, mfaEnabled: Boolean(user?.mfa_enabled_at), hasPassword: Boolean(user?.has_password), offer });
  const all = choice.first ? [choice.first, ...choice.others] : [];
  const proof = picked && all.includes(picked) ? picked : choice.first;
  const busy = step.isPending;
  const action = t(`settings.security.stepUp.actions.${ask.action}`);

  const fail = (error: unknown, start: "form" | "apple" | "google" = "form") => {
    const read = signInFailureOf(error, "step_up", start);
    // The server takes another proof now (the second factor turned on elsewhere): the sheet asks for that one.
    if (read.kind === "step_up" && read.proofs?.length) onProgress({ proofs: read.proofs, picked: null });
    setFailure(shownFailure(read));
    setRefusals((n) => n + 1);
    haptics.failure();
    requestAnimationFrame(() => field.current?.focus());
  };

  const prove = async (entry: ProofEntry) => {
    if (busy || !user) return;
    setFailure(null);
    onBusy(true);
    try {
      const result = await step.mutateAsync({ proof: entry, action: ask.action, userId: user.id });
      if (result === "held") onDone(true);
      else if (result === "unusable") fail(new Error("no usable step-up token"));
    } catch (error: unknown) {
      fail(error, entry.kind === "provider" ? entry.provider : "form");
    } finally {
      onBusy(false);
    }
  };

  const mailCode = async (): Promise<boolean> => {
    setFailure(null);
    try {
      return await sendCode.mutateAsync(ask.action);
    } catch (error: unknown) {
      fail(error);
      return false;
    }
  };

  const props = { busy, message, spoken, waiting, refusals, fieldRef: field };
  const body =
    proof === "password" ? (
      <PasswordProof
        {...props}
        onSubmit={(password) => void prove({ kind: "password", password })}
        onForgot={() => openWebPage(`${runtimeConfig().appUrl}${paths.forgotPassword()}`)}
      />
    ) : proof === "totp" ? (
      <SecondFactorProof {...props} onSubmit={(code) => void prove({ kind: "totp", code })} />
    ) : proof === "email_code" ? (
      <EmailCodeProof
        {...props}
        email={email}
        relay={isAppleRelayAddress(email)}
        sending={sendCode.isPending}
        sentAt={ask.mailedAt}
        onSent={(mailedAt) => onProgress({ mailedAt })}
        onSend={mailCode}
        onSubmit={(code) => void prove({ kind: "email_code", code })}
      />
    ) : proof === "apple" || proof === "google" ? (
      <ProviderProof
        provider={proof}
        busy={busy}
        message={message}
        spoken={spoken}
        onProve={() => void prove({ kind: "provider", provider: proof })}
      />
    ) : (
      <Text className="text-callout leading-5 text-muted-foreground" testID="step-up-unavailable">
        {t("mobile.step_up.unavailable")}
      </Text>
    );

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-4">
      <View className="gap-2">
        <Text accessibilityRole="header" className="text-title2 font-display font-bold text-foreground">
          {t("settings.security.stepUp.title")}
        </Text>
        <Text className="text-body leading-[22px] text-muted-foreground">{t("settings.security.stepUp.description", { action })}</Text>
      </View>
      {picking ? (
        <View className="gap-2" testID="step-up-ways">
          <Text accessibilityRole="header" className="text-subhead font-semibold text-foreground">
            {t("settings.security.stepUp.useAnother")}
          </Text>
          {all.map((way) => (
            <Pressable
              key={way}
              accessibilityRole="button"
              accessibilityState={{ selected: way === proof }}
              onPress={() => {
                onProgress({ picked: way });
                setPicking(false);
                setFailure(null);
              }}
              testID={`step-up-way-${way}`}
              className="min-h-12 justify-center rounded-xl border border-border bg-muted px-4 py-3 active:opacity-70"
            >
              <Text className="text-body text-foreground">{t(PROOF_LABEL[way])}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        body
      )}
      {proof && !picking ? (
        <Text className="text-footnote leading-[18px] text-muted-foreground">
          {proof === "email_code" ? t("mobile.step_up.one_action_hint", { action }) : t("settings.security.stepUp.windowHint")}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {all.length > 1 && !picking ? (
          <TextButton label={t("settings.security.stepUp.useAnother")} disabled={busy} onPress={() => setPicking(true)} testID="step-up-another" />
        ) : (
          <View />
        )}
        <TextButton label={t("settings.security.stepUp.cancel")} tone="muted" disabled={busy} onPress={() => onDone(false)} testID="step-up-cancel" />
      </View>
    </ScrollView>
  );
}
