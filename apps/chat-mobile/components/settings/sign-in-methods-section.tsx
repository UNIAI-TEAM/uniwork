// Settings › Sign-in methods on the phone (spec §4.5, §5.2), in the workspace's Settings tab and the account's own:
// the password, Google and Apple, with the web's rules (lib/sign-in-methods.ts over core's sign-in-rules). Every change
// confirms it is you first (use-step-up.ts), so a provider's own sheet never opens before the proof. Google links with
// its own sheet; Apple with the iPhone's; Apple on Android (and Google without Google Play services) in the browser,
// on the web's Settings, and the list is read again when the app comes back. The password is set or changed on its
// own screen (app/(app)/password.tsx). Unlinking takes the proof, then asks, says what is left, and that other devices
// sign out; the last way in, and Apple of an account whose address is Apple's relay, say why they stay.
import { useQuery } from "@tanstack/react-query";
import type { SignInMethods, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { sentenceValues, type SignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { linkAction, unlinkAction } from "@uniwork/core/auth/step-up";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, View } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useLinkSignInMethod, useUnlinkSignInMethod } from "@/data/mutations/sign-in-methods";
import { signInMethodsOptions, signInOfferOptions } from "@/data/queries/sign-in";
import { toast } from "@/data/stores/toast-store";
import { accountRoutes } from "@/lib/chat-routes";
import { signInFailureOf } from "@/lib/sign-in-failure";
import { methodRows, type MethodRow, type ProviderRow } from "@/lib/sign-in-methods";
import { MethodRowView, MethodsLoadError, MethodsSkeleton } from "./sign-in-method-row";
import { SettingsSection } from "./settings-section";
import { useOpenWebPage } from "./use-open-web-page";
import { useStepUp } from "./use-step-up";

export function SignInMethodsSection() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const accountEmail = useAuthStore((s) => s.user?.email ?? null);
  const methods = useQuery(signInMethodsOptions());
  const offer = useQuery(signInOfferOptions()).data;
  const openWebPage = useOpenWebPage();
  const stepUp = useStepUp();
  const link = useLinkSignInMethod();
  const unlink = useUnlinkSignInMethod();
  const [busy, setBusy] = useState<string | null>(null);
  const name = (provider: SignInProvider) => t(`auth.social.provider.${provider}`);

  /**
   * A refusal said once, in the web's words: a provider's sentence names it, an error sentence never does; a wait
   * says how long (a locked proof: "Thử lại sau 15 phút.").
   */
  const say = (failure: SignInFailure, provider: SignInProvider) => {
    const sentence = t(failure.key, sentenceValues({ ...failure, provider }, t));
    toast.error(failure.retry ? `${sentence} ${t(failure.retry.key, { count: failure.retry.count })}` : sentence);
  };

  const runLink = async (provider: SignInProvider, move: boolean) => {
    setBusy(`link-${provider}`);
    try {
      const result = await stepUp.run(linkAction(provider), (token) => link.mutateAsync({ provider, stepUpToken: token, move }), {
        proofs: methods.data?.proofs,
      });
      if (!result.done || result.value === null) return;
      const done = move ? "settings.security.signInMethods.move.toast" : "settings.security.signInMethods.results.linked";
      toast.success(t(done, { provider: name(provider) }));
    } catch (error: unknown) {
      const failure = signInFailureOf(error, "methods", provider);
      if (failure.kind === "move" && !move) confirmMove(provider, failure);
      else say(failure, provider);
    } finally {
      setBusy(null);
    }
  };

  /** The identity sits on an empty account of its own: move it here, after a confirm that says whose (masked). */
  const confirmMove = (provider: SignInProvider, failure: SignInFailure) => {
    const masked = failure.maskedEmail;
    const values = { provider: name(provider), masked: masked ?? "" };
    Alert.alert(
      t("settings.security.signInMethods.move.title", values),
      t(masked ? "settings.security.signInMethods.move.body" : "settings.security.signInMethods.move.bodyUnknown", values),
      [
        // The move's pair, as on the web and the link step: "Chuyển sang đây" / "Không chuyển".
        { text: t("settings.security.signInMethods.move.decline"), style: "cancel" },
        { text: t("settings.security.signInMethods.move.confirm"), onPress: () => void runLink(provider, true) },
      ],
    );
  };

  const startLink = (row: ProviderRow) => {
    if (busy) return;
    if (row.link === "web") {
      // The web's Settings, told whose account this is: a browser signed in as someone else says so (spec §4.5).
      openWebPage(`${runtimeConfig().appUrl}${paths.securitySettings(userId ? { expectUser: userId } : {})}`);
      return;
    }
    void runLink(row.kind, false);
  };

  const runUnlink = async (provider: SignInProvider) => {
    setBusy(`unlink-${provider}`);
    try {
      const result = await stepUp.run(unlinkAction(provider), (token) => unlink.mutateAsync({ provider, stepUpToken: token }), {
        proofs: methods.data?.proofs,
      });
      if (result.done) toast.success(t("settings.security.signInMethods.unlink.toast", { provider: name(provider) }));
    } catch (error: unknown) {
      say(signInFailureOf(error, "methods"), provider);
    } finally {
      setBusy(null);
    }
  };

  // The proof first, then the destructive confirm (spec §4.5, as the web): the confirm is the last word before the
  // unlink runs, on the token just bought, and a closed proof sheet asks nothing more.
  const askUnlink = async (row: ProviderRow) => {
    if (busy || !row.unlink.allowed) return;
    setBusy(`unlink-${row.kind}`);
    const proved = await stepUp.hold(unlinkAction(row.kind), { proofs: methods.data?.proofs }).finally(() => setBusy(null));
    if (!proved) return;
    const provider = name(row.kind);
    const method = (kind: string) => t(`settings.security.signInMethods.method.${kind}`);
    const [first, second] = row.remaining;
    const remaining = second
      ? t("settings.security.signInMethods.unlink.remainingTwo", { first: method(first ?? ""), second: method(second) })
      : t("settings.security.signInMethods.unlink.remainingOne", { method: method(first ?? "") });
    Alert.alert(
      t("settings.security.signInMethods.unlink.title", { provider }),
      [
        t("settings.security.signInMethods.unlink.body", { provider }),
        remaining,
        t("settings.security.signInMethods.unlink.signsOutOthers"),
      ].join(" "),
      [
        { text: t("settings.security.signInMethods.password.cancel"), style: "cancel" },
        { text: t("settings.security.signInMethods.unlink.confirm"), style: "destructive", onPress: () => void runUnlink(row.kind) },
      ],
    );
  };

  const onAction = (row: MethodRow) => {
    if (row.kind === "password") {
      if (!busy) router.push(accountRoutes.password);
      return;
    }
    if (row.linked) void askUnlink(row);
    else startLink(row);
  };

  return (
    <SettingsSection title={t("settings.security.signInMethods.title")} hint={t("settings.security.signInMethods.description")}>
      <View testID="sign-in-methods">
        {methods.isPending ? (
          <MethodsSkeleton />
        ) : methods.isError || !methods.data ? (
          <MethodsLoadError onRetry={() => void methods.refetch()} />
        ) : (
          <Rows methods={methods.data} offer={offer} accountEmail={accountEmail} busy={busy} onAction={onAction} />
        )}
      </View>
      {stepUp.sheet}
    </SettingsSection>
  );
}

/** Which action a row runs, as the section's `busy` names it. */
function actionId(row: MethodRow): string {
  if (row.kind === "password") return "password";
  return `${row.linked ? "unlink" : "link"}-${row.kind}`;
}

function Rows({
  methods,
  offer,
  accountEmail,
  busy,
  onAction,
}: {
  methods: SignInMethods;
  offer: Parameters<typeof methodRows>[1];
  accountEmail: string | null;
  busy: string | null;
  onAction: (row: MethodRow) => void;
}) {
  return (
    <>
      {methodRows(methods, offer, accountEmail).map((row, index) => {
        const id = actionId(row);
        return (
          <MethodRowView
            key={row.kind}
            row={row}
            first={index === 0}
            busy={busy === id}
            disabled={busy !== null && busy !== id}
            onAction={() => onAction(row)}
          />
        );
      })}
    </>
  );
}
