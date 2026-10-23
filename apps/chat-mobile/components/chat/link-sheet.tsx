// A link in a message: a tap opens it in
// the in-app browser, a long press — or a screen reader's "link" action on the
// bubble — opens this sheet: open it, copy it, or share it, as Slack and
// Telegram offer. The address heads the sheet so the reader sees where it goes.
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Share } from "react-native";
import { ActionSheet } from "@/components/ui/action-sheet";
import { bestEffort } from "@/data/report";
import { toast } from "@/data/stores/toast-store";
import { spokenLink } from "@/lib/message-format";

/** Opens a message's link in the in-app browser; a failure says so instead of doing nothing. Stable per language. */
export function useOpenLink() {
  const { t } = useTranslation();
  return useCallback((url: string) => void WebBrowser.openBrowserAsync(url).catch(() => toast.error(t("mobile.conversation.link_open_failed"))), [t]);
}

export function LinkSheet({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const open = useOpenLink();
  return (
    <ActionSheet
      visible={url !== null}
      onClose={onClose}
      title={url ? spokenLink(url) : undefined}
      actions={
        url
          ? [
              { key: "open", label: t("mobile.conversation.link_open"), icon: "open-outline", onPress: () => open(url) },
              {
                key: "copy",
                label: t("mobile.conversation.link_copy"),
                icon: "copy-outline",
                onPress: () =>
                  void Clipboard.setStringAsync(url).then(
                    () => toast.success(t("mobile.conversation.link_copied")),
                    () => toast.error(t("common.error")),
                  ),
              },
              {
                key: "share",
                label: t("mobile.conversation.link_share"),
                icon: "share-outline",
                onPress: () => void Share.share({ url, message: url }).catch(bestEffort("chat", "share sheet failed", "breadcrumb")),
              },
            ]
          : []
      }
    />
  );
}
