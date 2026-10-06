import { useEffect, type ReactNode } from "react";
import { applyDarkClass, type AppearanceBridge } from "./appearance";

/** Keep the host sized to its window and synchronize native control colours.
 * The OS theme arrives from main's nativeTheme through the preload event; a
 * host without that event follows the renderer's own colour-scheme query. */
export function DesktopFrame({ bridge, children }: { bridge: AppearanceBridge; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const publish = () => { void bridge.call("desktop:window-theme", { sessionGeneration: "desktop-dev-session", dark: root.classList.contains("dark") }).catch(() => undefined); };
    const observer = new MutationObserver(publish);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    let unsubscribe: () => void;
    if (bridge.onThemeChanged) {
      unsubscribe = bridge.onThemeChanged((event) => applyDarkClass(event.dark));
    } else {
      const media = window.matchMedia?.("(prefers-color-scheme: dark)");
      if (media?.matches) root.classList.add("dark");
      const onSystemTheme = () => applyDarkClass(media?.matches === true);
      media?.addEventListener("change", onSystemTheme);
      unsubscribe = () => media?.removeEventListener("change", onSystemTheme);
    }
    publish();
    return () => { observer.disconnect(); unsubscribe(); };
  }, [bridge]);
  return <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"><div className="min-h-0 flex-1 overflow-auto">{children}</div></div>;
}
