import { createRoot } from "react-dom/client";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import "@uniwork/core/i18n/office-resources";
import { App, type RendererBridge } from "./app";
import { DesktopFrame } from "./desktop-frame";

declare global {
  interface Window {
    uniworkOffice?: RendererBridge;
  }
}

initI18n();

const root = document.getElementById("root");
const bridge = window.uniworkOffice;

if (root && bridge) {
  document.documentElement.lang = "vi";
  void setLocale("vi").then(() => createRoot(root).render(<DesktopFrame bridge={bridge}><App bridge={bridge} /></DesktopFrame>));
}
