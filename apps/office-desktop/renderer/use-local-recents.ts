import { useEffect, useState } from "react";
import { recentFilesResponseSchema, type RecentFile } from "../shared/ipc";
import type { RendererBridge } from "./app";

const SESSION_GENERATION = "desktop-dev-session";

/** The encrypted recent-file list is main-owned; the renderer receives only
 * display rows (opaque id, name, shortened directory, time, missing flag). */
export function useLocalRecents(bridge: RendererBridge, enabled: boolean) {
  const [files, setFiles] = useState<readonly RecentFile[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadTicket, setReloadTicket] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError(false);
    void bridge.call("desktop:recent-list", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (!active) return;
      const parsed = recentFilesResponseSchema.safeParse(raw);
      if (!parsed.success) { setError(true); return; }
      setFiles(parsed.data.files);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [bridge, enabled, reloadTicket]);

  return {
    files,
    error,
    reload: () => setReloadTicket((value) => value + 1),
    async remove(id: string): Promise<boolean> {
      try {
        await bridge.call("desktop:recent-remove", { sessionGeneration: SESSION_GENERATION, id });
        setFiles((current) => (current ?? []).filter((file) => file.id !== id));
        return true;
      } catch { return false; }
    },
  };
}
