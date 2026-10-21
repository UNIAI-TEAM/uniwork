// Settings › Delete account (Apple 5.1.1(v), Google Play's account deletion
// policy), the phone's port of packages/views/settings/components/
// delete-account-dialog.tsx: what erasure does, the one proof the server
// asks for (lib/account-deletion.ts), POST /api/v1/me/delete, then a sign-out
// that wipes everything the account left on this phone
// (useAuthStore.accountDeleted). An owner is told to hand the organization
// over on the web first. Every refusal is said under the field and read out;
// the sheet is a Modal, so a toast would sit under it.
import { Ionicons } from "@expo/vector-icons";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { CallAwareModal } from "@/components/ui/call-aware-modal";
import { SafeAreaView } from "react-native-safe-area-context";
import { SheetGrabber } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { accountApi } from "@/data/account-api";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import { deleteAccountFailure, deleteProofBody, deleteProofMode, type DeleteProofMode } from "@/lib/account-deletion";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";
import { useOpenWebPage } from "./use-open-web-page";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

const INPUT: Record<DeleteProofMode, Pick<ComponentProps<typeof TextInput>, "secureTextEntry" | "keyboardType" | "autoComplete" | "textContentType">> = {
  password: { secureTextEntry: true, autoComplete: "current-password", textContentType: "password" },
  code: { keyboardType: "number-pad", autoComplete: "one-time-code", textContentType: "oneTimeCode" },
  email: { keyboardType: "email-address", autoComplete: "email", textContentType: "emailAddress" },
};

const CONSEQUENCES = [
  ["person-remove-outline", "mobile.account.consequence_identity"],
  ["chatbubbles-outline", "mobile.account.consequence_content"],
  ["phone-portrait-outline", "mobile.account.consequence_devices"],
  ["alert-circle-outline", "mobile.account.consequence_final"],
] as const;

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  orgSlug: string;
  wsSlug: string;
}

function DeleteAccountSheet({ visible, onClose, orgSlug, wsSlug }: SheetProps) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const user = useAuthStore((s) => s.user);
  const accountDeleted = useAuthStore((s) => s.accountDeleted);
  const openWebPage = useOpenWebPage();
  const mode = deleteProofMode(user);
  const [proof, setProof] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput>(null);
  const appUrl = runtimeConfig().appUrl;

  const close = () => {
    if (busy) return;
    setProof("");
    setError(null);
    setOwner(false);
    onClose();
  };

  const fail = (message: string) => {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
    input.current?.focus();
  };

  const submit = async () => {
    if (busy) return;
    if (!proof.trim()) {
      fail(t(`settings.security.delete.required.${mode}`));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await accountApi.deleteAccount(deleteProofBody(mode, proof));
    } catch (err) {
      setBusy(false);
      const failure = deleteAccountFailure(err);
      if (failure === "owner_must_transfer") {
        setOwner(true);
        AccessibilityInfo.announceForAccessibility(t("mobile.account.owner_title"));
        return;
      }
      // A password or a one-time code is never kept past a refusal; a typed address stays to be corrected.
      if (failure === "proof_refused" && mode !== "email") setProof("");
      fail(
        failure === "proof_refused"
          ? t(`settings.security.delete.incorrect.${mode}`)
          : failure === "rate_limited"
            ? t("mobile.account.rate_limited")
            : failure === "offline"
              ? t("mobile.account.offline")
              : t("settings.security.delete.failed"),
      );
      return;
    }
    // The account is gone server-side: whatever happens next, this phone signs out
    // (accountDeleted drops the user first; a wipe step that fails is logged there).
    try {
      await accountDeleted();
    } catch {
      // The user is already dropped (accountDeleted's first step), so the app is signed out regardless.
    }
    setBusy(false);
    setProof("");
    onClose();
    toast.success(t("mobile.account.deleted"));
  };

  return (
    <CallAwareModal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 bg-black/40" onPress={close} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="max-h-[92%]">
        <SafeAreaView edges={["bottom"]} className="rounded-t-[24px] bg-card" style={continuousCorners} accessibilityViewIsModal>
          <SheetGrabber />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-4">
            <Text accessibilityRole="header" className="text-xl font-display font-bold text-foreground">
              {t("settings.security.delete.title")}
            </Text>
            <Text className="text-base leading-[22px] text-foreground">{t("settings.security.delete.body")}</Text>
            <View className="gap-2.5 rounded-xl bg-muted p-3.5" style={continuousCorners}>
              <Text accessibilityRole="header" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("mobile.account.what_happens")}
              </Text>
              {CONSEQUENCES.map(([icon, key]) => (
                <View key={key} className="flex-row items-start gap-2.5">
                  <Ionicons name={icon} size={18} color={theme.mutedForeground} style={{ marginTop: 2 }} />
                  <Text className="flex-1 text-[15px] leading-[21px] text-foreground">{t(key)}</Text>
                </View>
              ))}
              <Pressable
                accessibilityRole="link"
                onPress={() => openWebPage(legalLinks(appUrl, legalLocale(i18n.language), "").deleteAccount)}
                className="min-h-11 justify-center self-start"
              >
                <Text className="text-[15px] font-semibold text-primary">{t("mobile.account.policy_link")}</Text>
              </Pressable>
            </View>

            {owner ? (
              <View accessibilityRole="alert" className="gap-2.5 rounded-xl border border-destructive/40 p-3.5" style={continuousCorners}>
                <Text className="text-base font-semibold text-foreground">{t("mobile.account.owner_title")}</Text>
                <Text className="text-[15px] leading-[21px] text-foreground">{t("mobile.account.owner_body")}</Text>
                <Pressable
                  accessibilityRole="link"
                  // The label, not the children: the icon's glyph is a character a screen reader would spell.
                  accessibilityLabel={t("mobile.account.owner_open_web")}
                  onPress={() => openWebPage(`${appUrl}${paths.workspace(orgSlug, wsSlug).settings()}`)}
                  className="h-11 flex-row items-center justify-center gap-2 rounded-full bg-muted active:opacity-70"
                >
                  <Text className="text-[15px] font-semibold text-foreground">{t("mobile.account.owner_open_web")}</Text>
                  <Ionicons name="open-outline" size={16} color={theme.foreground} />
                </Pressable>
              </View>
            ) : (
              <View className="gap-1.5">
                <Text className="text-[15px] font-semibold text-foreground">{t(`settings.security.delete.proof.${mode}`)}</Text>
                <TextInput
                  ref={input}
                  value={proof}
                  onChangeText={(next) => {
                    setProof(next);
                    setError(null);
                  }}
                  {...INPUT[mode]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  placeholder={mode === "email" ? (user?.email ?? "") : undefined}
                  placeholderTextColor={theme.mutedForeground}
                  accessibilityLabel={t(`settings.security.delete.proof.${mode}`)}
                  accessibilityHint={t("settings.security.delete.ownerHint")}
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                  testID="delete-account-proof"
                  className={cn("h-12 rounded-xl border bg-muted px-3.5 text-base text-foreground", error ? "border-destructive" : "border-border")}
                />
                {error ? (
                  <Text accessibilityRole="alert" className="text-[15px] text-destructive">
                    {error}
                  </Text>
                ) : null}
                <Text className="text-[13px] leading-[18px] text-muted-foreground">{t("settings.security.delete.ownerHint")}</Text>
              </View>
            )}

            <View className="gap-2.5 pt-1">
              {owner ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy, disabled: busy }}
                  testID="delete-account-confirm"
                  onPress={() => void submit()}
                  className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full bg-destructive-solid", busy ? "opacity-70" : "active:opacity-90")}
                >
                  {busy ? <ActivityIndicator color={THEME.light.primaryForeground} /> : null}
                  <Text className="text-base font-semibold text-on-solid">{busy ? t("mobile.account.deleting") : t("settings.security.delete.confirm")}</Text>
                </Pressable>
              )}
              <Pressable accessibilityRole="button" onPress={close} className="h-12 items-center justify-center rounded-full bg-muted active:opacity-70">
                <Text className="text-base font-semibold text-foreground">{t("settings.security.delete.cancel")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </CallAwareModal>
  );
}

/** The danger zone at the end of Settings: one row that opens the sheet. */
export function DeleteAccountSection({ orgSlug, wsSlug }: { orgSlug: string; wsSlug: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title={t("settings.security.delete.section")} hint={t("settings.security.delete.hint")}>
      <SettingsRow first destructive icon="trash-outline" label={t("settings.security.delete.open")} testID="settings-delete-account" onPress={() => setOpen(true)} />
      <DeleteAccountSheet visible={open} onClose={() => setOpen(false)} orgSlug={orgSlug} wsSlug={wsSlug} />
    </SettingsSection>
  );
}
