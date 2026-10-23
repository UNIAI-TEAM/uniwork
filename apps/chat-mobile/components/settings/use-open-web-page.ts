// Opens a web page (a policy, a package's page, the web settings) in the
// in-app browser; a build without a web origin or a browser that fails says
// so in a toast instead of doing nothing.
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { toast } from "@/data/stores/toast-store";
import { isOpenableWebUrl } from "@/lib/legal-links";

export function useOpenWebPage(): (url: string) => void {
  const { t } = useTranslation();
  return (url: string) => {
    if (!isOpenableWebUrl(url)) {
      toast.error(t("mobile.legal.open_failed"));
      return;
    }
    WebBrowser.openBrowserAsync(url).catch(() => toast.error(t("mobile.legal.open_failed")));
  };
}
