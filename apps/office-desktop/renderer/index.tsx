import { createRoot } from "react-dom/client";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { App } from "./app";
import { applyDarkClass, pickDesktopLocale, readAppearance, type AppearanceBridge } from "./appearance";
import { DesktopFrame } from "./desktop-frame";

declare global {
  interface Window {
    uniworkOffice?: AppearanceBridge;
  }
}

const i18n = initI18n();
// Every later language switch keeps the document language in step.
i18n.on("languageChanged", (language: string) => { document.documentElement.lang = language; });

const root = document.getElementById("root");
const bridge = window.uniworkOffice;

async function start(container: HTMLElement, host: AppearanceBridge): Promise<void> {
  const appearance = await readAppearance(host);
  applyDarkClass(appearance.dark);
  const locale = pickDesktopLocale(appearance.languages);
  document.documentElement.lang = locale;
  await setLocale(locale);
  createRoot(container).render(<DesktopFrame bridge={host}><App bridge={host} /></DesktopFrame>);
}

if (root && bridge) void start(root, bridge);
