import { useEffect, useRef } from "react";
import { officeFormatFlagKey, OFFICE_ENGINE_FLAG } from "@uniwork/core/office";
import { desktopPublicConfigResponseSchema } from "../shared/ipc";
import type { RendererBridge } from "./app";

/**
 * The server's public Office flags for the signed-in account (UNI-941). A cloud
 * document is editable only when `office_engine` AND its format's own flag are
 * on, the same rule the web host applies. Until the answer arrives, and when it
 * fails, no flag is known: the engine reads off, so cloud documents open
 * read-only (fail closed) while local files are never gated by server flags.
 */
export function useOfficeFlags(bridge: RendererBridge, enabled: boolean, reload: unknown) {
  const flags = useRef<Readonly<Record<string, boolean>>>({});
  useEffect(() => {
    flags.current = {};
    if (!enabled) return;
    let active = true;
    void bridge.call("desktop:public-config", { sessionGeneration: "desktop-dev-session" }).then((raw) => {
      const parsed = desktopPublicConfigResponseSchema.safeParse(raw);
      if (active && parsed.success) flags.current = parsed.data.flags;
    }).catch(() => undefined);
    return () => { active = false; };
  }, [bridge, enabled, reload]);
  return (format: string): boolean => {
    if (flags.current[OFFICE_ENGINE_FLAG] !== true) return false;
    const key = officeFormatFlagKey(format);
    return key === null || flags.current[key] !== false;
  };
}
