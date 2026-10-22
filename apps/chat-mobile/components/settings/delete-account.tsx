// Settings › Delete account (Apple 5.1.1(v), Google Play's account deletion
// policy), the phone's port of packages/views/settings/components/
// delete-account-dialog.tsx: what erasure does, the one proof the server
// asks for (lib/account-deletion.ts), POST /api/v1/me/delete, then a sign-out
// that wipes everything the account left on this phone
// (useAuthStore.accountDeleted). An owner closes the organization or hands it over first, a step the web's dialog
// does not have (use-owner-step.ts, delete-account-owner.tsx). Mounted in the workspace's Settings tab and, with no
// workspace, in the account's own Settings (app/(app)/account.tsx): deletion is
// reachable from every signed-in state. Every refusal is said under the field and read out;
// the sheet is a Modal, so a toast would sit under it.
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
import { deleteAccountFailure, deleteProofBody, deleteProofMode, type DeleteProofMode } from "@/lib/account-deletion";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import { DeleteAccountConsequences } from "./delete-account-consequences";
import { OwnerStepPanel } from "./delete-account-owner";
import { useOwnerStep, type Field } from "./use-owner-step";
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

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  /** The workspace whose web settings hold the organization's ownership; none from the account's own Settings. */
  workspace?: WorkspaceSlugs;
}

function DeleteAccountSheet({ visible, onClose, workspace }: SheetProps) {
  const { t } = useTranslation();
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
  const [busy, setBusy] = useState<"transfer" | "erase" | null>(null);
  const deleteAccount = useDeleteAccount().mutateAsync;
  const proofInput = useRef<TextInput>(null);
  const appUrl = runtimeConfig().appUrl;

  /** Says a refusal under the field it is about and focuses that field when it is one to type in. */
  const fail = (message: string, field: Field) => {
    setError({ message, field });
    AccessibilityInfo.announceForAccessibility(message);
    if (field !== "pick") (field === "proof" ? proofInput : ownerStep.slugInput).current?.focus();
  };

  /** A password or a one-time code is never kept past a refusal; a typed address stays to be corrected. */
  const refuseProof = () => {
    if (mode !== "email") setProof("");
    setProofAgain(true);
    fail(t(`settings.security.delete.incorrect.${mode}`), "proof");
  };

  /** Rate limit, no network, or anything else: said where the person was acting. */
  const generic = (failure: string) =>
    failure === "rate_limited"
      ? t("mobile.account.rate_limited")
      : failure === "offline"
        ? t("mobile.account.offline")
        : t("settings.security.delete.failed");

  const startBusy = (next: "transfer" | "erase" | null) => {
    if (next) setError(null);
    setBusy(next);
  };

  const ownerStep = useOwnerStep(mode, { fail, generic, refuseProof, clearProof: () => setProof(""), setBusy: startBusy });

  const close = () => {
    if (busy) return;
    ownerStep.reset();
    setProof("");
    setError(null);
    setProofAgain(false);
    onClose();
  };

  const submit = async () => {
    if (busy) return;
    if (!proof.trim()) {
      fail(t(`settings.security.delete.required.${mode}`), "proof");
      return;
    }
    if (!(await ownerStep.beforeErase(proof))) return;
    // Where a failure that is about no one field is said: beside the address while closing, else under the proof.
    const here = ownerStep.here();
    startBusy("erase");
    try {
      await deleteAccount({ ...deleteProofBody(mode, proof), ...ownerStep.body() });
    } catch (err) {
      setBusy(null);
      const failure = deleteAccountFailure(err);
      if (ownerStep.answer(failure, err)) return;
      if (failure === "proof_refused") refuseProof();
      else fail(generic(failure), here);
      return;
    }
    // The account is gone server-side: whatever happens next, this phone signs out
    // (accountDeleted drops the user first; a wipe step that fails is logged there).
    try {
      await accountDeleted();
    } catch {
      // The user is already dropped (accountDeleted's first step), so the app is signed out regardless.
    }
    setBusy(null);
    setProof("");
    onClose();
    toast.success(t("mobile.account.deleted"));
  };

  const openOrganizationOnWeb = () =>
    openWebPage(`${appUrl}${workspace ? paths.workspace(workspace.orgSlug, workspace.wsSlug).settings() : paths.root()}`);
  const confirmLabel =
    busy === "transfer"
      ? t("mobile.account.transferring")
      : busy === "erase"
        ? t("mobile.account.deleting")
        : (ownerStep.confirmLabel() ?? t("settings.security.delete.confirm"));

  return (
    <BottomSheet visible={visible} onClose={close} dragFrom="handle" avoidKeyboard keyboardClassName="max-h-[92%]">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-4">
        <Text accessibilityRole="header" className="text-title2 font-display font-bold text-foreground">
          {t("settings.security.delete.title")}
        </Text>
        <Text className="text-body leading-[22px] text-foreground">{t("settings.security.delete.body")}</Text>
        <DeleteAccountConsequences appUrl={appUrl} iconColor={theme.mutedForeground} onOpenPage={openWebPage} />

        <OwnerStepPanel
          step={ownerStep}
          error={error}
          busy={busy !== null}
          foreground={theme.foreground}
          placeholderColor={theme.mutedForeground}
          onEdit={() => setError(null)}
          onSubmit={() => void submit()}
          onOpenWeb={openOrganizationOnWeb}
        />
        {ownerStep.proofShown(proofAgain) ? (
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
              editable={busy === null}
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
              {ownerStep.closing && mode === "code" ? t("mobile.account.close_code_again") : t("settings.security.delete.ownerHint")}
            </Text>
          </View>
        ) : null}

        <View className="gap-2.5 pt-1">
          {ownerStep.stranded ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: busy !== null, disabled: busy !== null }}
              testID="delete-account-confirm"
              onPress={() => void submit()}
              className={cn(
                "min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-destructive-solid py-3",
                busy ? "opacity-70" : "active:opacity-90",
              )}
            >
              {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} color={THEME.light.primaryForeground} /> : null}
              <Text className="text-body font-semibold text-on-solid">{confirmLabel}</Text>
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
