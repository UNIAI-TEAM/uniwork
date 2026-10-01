import { createRoot } from "react-dom/client";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { App, type RendererBridge } from "./app";

declare global {
  interface Window {
    uniworkOffice?: RendererBridge;
  }
}

initI18n();

const root = document.getElementById("root");
const bridge = window.uniworkOffice;

if (root && bridge) {
  void setLocale("vi").finally(() => {
    document.documentElement.lang = "vi";
    createRoot(root).render(<App bridge={bridge} />);
  });
}
