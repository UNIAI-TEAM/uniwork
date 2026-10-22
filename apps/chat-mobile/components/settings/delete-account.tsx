// Settings › Delete account (Apple 5.1.1(v), Google Play's account deletion
// policy), the phone's port of packages/views/settings/components/
// delete-account-dialog.tsx: what erasure does, the one proof the server
// asks for (lib/account-deletion.ts), POST /api/v1/me/delete, then a sign-out
// that wipes everything the account left on this phone
// (useAuthStore.accountDeleted). An owner who is the organization's only active
// member closes it in the same request, typing its address again; one with
// members is told to hand it over on the web first (delete-account-owner.tsx). A two-factor code is spent by the
// first request (a recovery code is burned, a TOTP code expires while the address is typed), so closing asks for a
// fresh one beside the address; any proof the server refuses comes back on screen.
// Mounted in the workspace's Settings tab and, with no
// workspace, in the account's own Settings (app/(app)/account.tsx): deletion is
// reachable from every signed-in state. Every refusal is said under the field and read out;
// the sheet is a Modal, so a toast would sit under it.
import { Ionicons } from "@expo/vector-icons";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useDeleteAccount } from "@/data/mutations/account";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import type { WorkspaceSlugs } from "@/lib/chat-routes";
import {
  closeConfirmed,
  deleteAccountFailure,
  deleteProofBody,
  deleteProofMode,
  ownedOrganization,
  type DeleteProofMode,
  type OwnedOrganization,
} from "@/lib/account-deletion";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import { CloseOrganizationField, OwnerTransferPanel } from "./delete-account-owner";
import { useOpenWebPage } from "./use-open-web-page";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

const INPUT: Record<
  DeleteProofMode,
  Pick<ComponentProps<typeof TextInput>, "secureTextEntry" | "keyboardType" | "autoComplete" | "textContentType">
> = {
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

/** An owner's state once the server said so: the organization it named (null from an older server), and whether to close it. */
/** The field a refusal is said under: the proof, or the organization's address typed to close it. */
type Field = "proof" | "slug";

interface OwnerState {
  organization: OwnedOrganization | null;
  /** Why closing is no longer offered, when it stopped being (someone joined meanwhile). */
  notice: string | null;
}

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** The workspace whose web settings hold the organization's ownership; none from the account's own Settings. */
  workspace?: WorkspaceSlugs;
}

function DeleteAccountSheet({ visible, onClose, workspace }: SheetProps) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const user = useAuthStore((s) => s.user);
  const accountDeleted = useAuthStore((s) => s.accountDeleted);
  const openWebPage = useOpenWebPage();
  const mode = deleteProofMode(user);
  const [proof, setProof] = useState("");
  const [error, setError] = useState<{ message: string; field: Field } | null>(null);
  /** Set when the server refused the proof while closing: the proof field is back on screen whatever the mode. */
  const [proofAgain, setProofAgain] = useState(false);
  const [owner, setOwner] = useState<OwnerState | null>(null);
  const [closeSlug, setCloseSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const deleteAccount = useDeleteAccount().mutateAsync;
  const proofInput = useRef<TextInput>(null);
  const slugInput = useRef<TextInput>(null);
  const appUrl = runtimeConfig().appUrl;

  const close = () => {
    if (busy) return;
    setProof("");
    setError(null);
    setProofAgain(false);
    setOwner(null);
    setCloseSlug("");
    onClose();
  };

  // Set once the server named an organization this account alone can close: the next submit closes it too.
  const closing = owner?.organization?.canClose ? owner.organization : null;
  const proofShown = !closing || mode === "code" || proofAgain;

  /** Says a refusal under the field it is about (the address while closing, unless it is the proof) and focuses it. */
  const fail = (message: string, field: Field = closing ? "slug" : "proof") => {
    setError({ message, field });
    AccessibilityInfo.announceForAccessibility(message);
    (field === "proof" ? proofInput : slugInput).current?.focus();
  };

  const submit = async () => {
    if (busy) return;
    if (!proof.trim()) {
      fail(t(`settings.security.delete.required.${mode}`), "proof");
      return;
    }
    if (closing && !closeConfirmed(closeSlug, closing)) {
      fail(t(closeSlug.trim() ? "mobile.account.close_mismatch" : "mobile.account.close_required"), "slug");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(deleteProofBody(mode, proof, closing?.slug));
    } catch (err) {
      setBusy(false);
      const failure = deleteAccountFailure(err);
      if (failure === "owner_must_transfer") {
        const organization = ownedOrganization(err);
        setOwner({ organization, notice: null });
        // The code this request carried is spent: the closing request needs a new one.
        const freshCode = organization?.canClose && mode === "code";
        if (freshCode) setProof("");
        AccessibilityInfo.announceForAccessibility(
          organization?.canClose
            ? `${t("mobile.account.close_title")}${freshCode ? `. ${t("mobile.account.close_code_again")}` : ""}`
            : t("mobile.account.owner_title"),
        );
        return;
      }
      if (failure === "organization_has_members") {
        // Someone joined between the two answers: closing is off, ownership goes to them on the web.
        const notice = t("mobile.account.close_has_members");
        setOwner({ organization: closing && { ...closing, canClose: false }, notice });
        AccessibilityInfo.announceForAccessibility(notice);
        return;
      }
      if (failure === "close_mismatch") {
        fail(t("mobile.account.close_mismatch"), "slug");
        return;
      }
      if (failure === "proof_refused") {
        // A password or a one-time code is never kept past a refusal; a typed address stays to be corrected.
        if (mode !== "email") setProof("");
        setProofAgain(true);
        fail(t(`settings.security.delete.incorrect.${mode}`), "proof");
        return;
      }
      fail(
        failure === "rate_limited"
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
    <BottomSheet visible={visible} onClose={close} dragFrom="handle" avoidKeyboard keyboardClassName="max-h-[92%]">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-4">
        <Text accessibilityRole="header" className="text-title2 font-display font-bold text-foreground">
          {t("settings.security.delete.title")}
        </Text>
        <Text className="text-body leading-[22px] text-foreground">{t("settings.security.delete.body")}</Text>
        <View className="gap-2.5 rounded-xl bg-muted p-3.5" style={continuousCorners}>
          <Text accessibilityRole="header" className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
            {t("mobile.account.what_happens")}
          </Text>
          {CONSEQUENCES.map(([icon, key]) => (
            <View key={key} className="flex-row items-start gap-2.5">
              <Ionicons name={icon} size={18} color={theme.mutedForeground} style={{ marginTop: 2 }} />
              <Text className="flex-1 text-subhead leading-[21px] text-foreground">{t(key)}</Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="link"
            onPress={() => openWebPage(legalLinks(appUrl, legalLocale(i18n.language), "").deleteAccount)}
            className="min-h-11 justify-center self-start"
          >
            <Text className="text-subhead font-semibold text-primary">{t("mobile.account.policy_link")}</Text>
          </Pressable>
        </View>

        {closing ? (
          <CloseOrganizationField
            organization={closing}
            value={closeSlug}
            onChangeText={(next) => {
              setCloseSlug(next);
              setError(null);
            }}
            error={error?.field === "slug" ? error.message : null}
            busy={busy}
            placeholderColor={theme.mutedForeground}
            onSubmit={() => void submit()}
            inputRef={slugInput}
          />
        ) : null}
        {owner && !closing ? (
          <OwnerTransferPanel
            organization={owner.organization}
            notice={owner.notice}
            foreground={theme.foreground}
            onOpenWeb={() => openWebPage(`${appUrl}${workspace ? paths.workspace(workspace.orgSlug, workspace.wsSlug).settings() : paths.root()}`)}
          />
        ) : proofShown ? (
          <View className="gap-1.5">
            <Text className="text-subhead font-semibold text-foreground">{t(`settings.security.delete.proof.${mode}`)}</Text>
            <TextInput
              ref={proofInput}
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
              className={cn(
                "min-h-12 rounded-xl border bg-muted px-3.5 py-3 text-body text-foreground",
                error?.field === "proof" ? "border-destructive" : "border-border",
              )}
            />
            {error?.field === "proof" ? (
              <Text accessibilityRole="alert" className="text-subhead text-destructive">
                {error.message}
              </Text>
            ) : null}
            <Text className="text-footnote leading-[18px] text-muted-foreground">
              {closing && mode === "code" ? t("mobile.account.close_code_again") : t("settings.security.delete.ownerHint")}
            </Text>
          </View>
        ) : null}

        <View className="gap-2.5 pt-1">
          {owner && !closing ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              testID="delete-account-confirm"
              onPress={() => void submit()}
              className={cn(
                "min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-destructive-solid py-3",
                busy ? "opacity-70" : "active:opacity-90",
              )}
            >
              {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} color={THEME.light.primaryForeground} /> : null}
              <Text className="text-body font-semibold text-on-solid">
                {busy ? t("mobile.account.deleting") : closing ? t("mobile.account.close_confirm") : t("settings.security.delete.confirm")}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={close}
            className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70"
          >
            <Text className="text-body font-semibold text-foreground">{t("settings.security.delete.cancel")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

/** The danger zone at the end of Settings: one row that opens the sheet. */
export function DeleteAccountSection({ workspace }: { workspace?: WorkspaceSlugs }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection title={t("settings.security.delete.section")} hint={t("settings.security.delete.hint")}>
      <SettingsRow
        first
        destructive
        icon="trash-outline"
        label={t("settings.security.delete.open")}
        testID="settings-delete-account"
        onPress={() => setOpen(true)}
      />
      <DeleteAccountSheet visible={open} onClose={() => setOpen(false)} workspace={workspace} />
    </SettingsSection>
  );
}
