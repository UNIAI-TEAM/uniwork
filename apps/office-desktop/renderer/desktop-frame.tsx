import { useEffect, type ReactNode } from "react";
import type { RendererBridge } from "./app";

/** Keep the host sized to its window and synchronize native control colours. */
export function DesktopFrame({ bridge, children }: { bridge: RendererBridge; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (media?.matches) root.classList.add("dark");
    const publish = () => { void bridge.call("desktop:window-theme", { sessionGeneration: "desktop-dev-session", dark: root.classList.contains("dark") }).catch(() => undefined); };
    const onSystemTheme = () => root.classList.toggle("dark", media?.matches === true);
    const observer = new MutationObserver(publish);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    media?.addEventListener("change", onSystemTheme);
    publish();
    return () => { observer.disconnect(); media?.removeEventListener("change", onSystemTheme); };
  }, [bridge]);
  return <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"><div className="min-h-0 flex-1 overflow-auto">{children}</div></div>;
}
