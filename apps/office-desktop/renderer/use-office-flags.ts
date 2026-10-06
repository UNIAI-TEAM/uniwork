import { useCallback, useEffect, useRef, useState } from "react";
import { officeFlagsAllow } from "@uniwork/core/office";
import { desktopPublicConfigResponseSchema } from "../shared/ipc";
import type { RendererBridge } from "./app";
import type { useDocumentTabs } from "./tabs/use-document-tabs";

type Flags = Readonly<Record<string, boolean>>;
interface Answer { readonly scopeKey: string; readonly flags: Flags }

/** How long a cloud open waits for an in-flight flags fetch before it fails closed. */
const FLAGS_WAIT_MS = 3_000;

/** One config read, retried once when the call throws. A malformed answer is not retried. */
async function fetchFlags(bridge: RendererBridge, sessionGeneration: string, organizationId: string): Promise<Flags | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = desktopPublicConfigResponseSchema.safeParse(await bridge.call("desktop:public-config", { sessionGeneration, organizationId }));
      return parsed.success ? parsed.data.flags : null;
    } catch { /* one retry */ }
  }
  return null;
}

/**
 * The server's public Office flags for the signed-in account and the selected
 * organization (UNI-941): organization-scoped overrides only evaluate when the
 * server is asked for that organization. A cloud document is editable only when
 * `office_engine` AND its format's own flag are on, the same rule the web host
 * applies. Flags live in state, so a late answer re-renders; `settled()` lets a
 * cloud open wait (briefly) for the in-flight fetch. While unknown, and when the
 * fetch fails, the engine reads off and cloud documents open read-only (fail
 * closed); a context reload keeps the previous answer for the same account and
 * organization. Local files are never gated by server flags.
 */
export function useOfficeFlags(bridge: RendererBridge, input: { enabled: boolean; sessionGeneration: string; accountKey: string | undefined; organizationId: string | undefined; reload: number }) {
  const { enabled, sessionGeneration, accountKey, organizationId, reload } = input;
  const scopeKey = enabled && organizationId ? `${accountKey ?? ""}|${organizationId}` : null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const latest = useRef<Answer | null>(null);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const inflight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!organizationId || scopeKey === null) { inflight.current = null; return; }
    let active = true;
    const pending = fetchFlags(bridge, sessionGeneration, organizationId).then((flags) => {
      if (!active || !flags) return;
      latest.current = { scopeKey, flags };
      setAnswer(latest.current);
    });
    inflight.current = pending;
    return () => { active = false; };
  }, [bridge, sessionGeneration, scopeKey, organizationId, reload]);

  const flags = answer?.scopeKey === scopeKey ? answer.flags : null;
  /** Reads the newest answer, not the render it was created in. */
  const allows = useCallback((format: string): boolean => {
    const known = latest.current?.scopeKey === currentScope.current ? latest.current.flags : null;
    return known !== null && officeFlagsAllow(known, format);
  }, []);
  const settled = useCallback(async (): Promise<void> => {
    const pending = inflight.current;
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, FLAGS_WAIT_MS); })]);
    clearTimeout(timer);
  }, []);
  return { flags, allows, settled };
}

/**
 * Cloud tabs that opened read-only only because no flags were known yet (or the
 * flags said no) become editable once an answer allows their format. Only a tab
 * that never went dirty is upgraded: a read-only surface cannot edit, and an
 * upgrade swaps its session, so a dirty one is left alone.
 */
export function useFlagGatedTabs(tabs: ReturnType<typeof useDocumentTabs>, officeFlags: ReturnType<typeof useOfficeFlags>) {
  const gated = useRef(new Set<string>());
  const { flags, allows } = officeFlags;
  useEffect(() => {
    if (flags === null) return;
    for (const id of [...gated.current]) {
      const tab = tabs.current.current.tabs.find((entry) => entry.id === id);
      if (!tab) { gated.current.delete(id); continue; }
      if (allows(tab.format) && tabs.upgradeCloud(id)) gated.current.delete(id);
    }
  // The tab set is read through its live ref; this only reacts to a new answer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);
  return (documentId: string) => { gated.current.add(documentId); };
}
