// Settings › Delete account (Apple 5.1.1(v), Google Play's account deletion
// policy), the phone's port of packages/views/settings/components/
// delete-account-dialog.tsx: what erasure does, "Xác nhận là bạn" (a step-up
// token for delete_account, ADR 0049 §5: the proof sheet, use-step-up.ts), POST
// /api/v1/me/delete, then a sign-out that wipes everything the account left on
// this phone (useAuthStore.accountDeleted). An owner closes the organization or hands it over first, a step the web's
// dialog does not have (use-owner-step.ts, delete-account-owner.tsx). Mounted in the workspace's Settings tab and, with
// no workspace, in the account's own Settings (app/(app)/account.tsx): deletion is reachable from every signed-in
// state. Every refusal is said in the sheet and read out; the sheet is a Modal, so a toast would sit under it. The
// proof sheet opens inside this one, so it presents above it.
import { paths } from "@uniwork/core/paths/paths";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ScrollView } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useDeleteAccount } from "@/data/mutations/account";
import { useAuthStore } from "@/data/auth/store";
import { toast } from "@/data/stores/toast-store";
import type { WorkspaceSlugs } from "@/lib/chat-routes";
import { deleteAccountFailure, deleteFailureKey } from "@/lib/account-deletion";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { DeleteAccountActions } from "./delete-account-actions";
import { DeleteAccountConsequences } from "./delete-account-consequences";
import { OwnerStepPanel } from "./delete-account-owner";
import { useOwnerStep, type Field } from "./use-owner-step";
import { useOpenWebPage } from "./use-open-web-page";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";
import { useStepUp } from "./use-step-up";

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
  const accountDeleted = useAuthStore((s) => s.accountDeleted);
  const openWebPage = useOpenWebPage();
  // The proof sheet opens inside this one: the app lock closes it, as it closes this one (use-step-up.ts).
  const stepUp = useStepUp({ insideSheet: true });
  const [error, setError] = useState<{ message: string; field: Field } | null>(null);
  const [busy, setBusy] = useState<"transfer" | "erase" | null>(null);
  /** A step (the proof sheet, a hand-over, the erasure) is under way: one at a time. */
  const [running, setRunning] = useState(false);
  const deleteAccount = useDeleteAccount().mutateAsync;
  const appUrl = runtimeConfig().appUrl;

  /** Says a refusal where it is about and reads it out; the address field is focused when it is about that. */
  const fail = (message: string, field: Field) => {
    setError({ message, field });
    AccessibilityInfo.announceForAccessibility(message);
    if (field === "slug") ownerStep.slugInput.current?.focus();
  };

  /** Rate limit, no network, a proof the server kept refusing, or anything else: said where the person was acting. */
  const generic = (failure: string) => t(deleteFailureKey(failure));

  const startBusy = (next: "transfer" | "erase" | null) => {
    if (next) setError(null);
    setBusy(next);
  };

  const ownerStep = useOwnerStep({
    fail,
    generic,
    setBusy: startBusy,
    confirm: (command) => stepUp.run("transfer_ownership", command),
    hold: stepUp.hold,
  });

  const close = () => {
    if (running) return;
    ownerStep.reset();
    setError(null);
    onClose();
  };

  const erase = async (): Promise<boolean> => {
    // Where a failure that is about no one field is said: beside the address while closing, else above the buttons.
    const here = ownerStep.here();
    try {
      const result = await stepUp.run("delete_account", async (token) => {
        startBusy("erase");
        try {
          await deleteAccount({ step_up_token: token, ...ownerStep.body() });
        } finally {
          setBusy(null);
        }
      });
      return result.done;
    } catch (err) {
      const failure = deleteAccountFailure(err);
      if (ownerStep.answer(failure, err)) return false;
      fail(generic(readSignInFailure(err, "methods").kind === "step_up" ? "proof_required" : failure), here);
      return false;
    }
  };

  const submit = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      if (!(await ownerStep.beforeErase()) || !(await erase())) return;
    } finally {
      setRunning(false);
    }
    // The account is gone server-side: whatever happens next, this phone signs out
    // (accountDeleted drops the user first; a wipe step that fails is logged there).
    try {
      await accountDeleted();
    } catch {
      // The user is already dropped (accountDeleted's first step), so the app is signed out regardless.
    }
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
          busy={running}
          foreground={theme.foreground}
          placeholderColor={theme.mutedForeground}
          onEdit={() => setError(null)}
          onSubmit={() => void submit()}
          onOpenWeb={openOrganizationOnWeb}
        />
        {error?.field === "form" ? (
          <Text accessibilityRole="alert" className="text-subhead text-destructive" testID="delete-account-error">
            {error.message}
          </Text>
        ) : null}

        <DeleteAccountActions
          label={confirmLabel}
          busy={busy !== null}
          running={running}
          stranded={ownerStep.stranded}
          onConfirm={() => void submit()}
          onCancel={close}
        />
      </ScrollView>
      {stepUp.sheet}
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
