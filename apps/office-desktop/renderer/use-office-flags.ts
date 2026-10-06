import { useCallback, useEffect, useRef, useState } from "react";
import { officeFlagsAllow } from "@uniwork/core/office";
import { desktopPublicConfigResponseSchema } from "../shared/ipc";
import type { RendererBridge } from "./app";
import type { CloudReopen, TabDocument, useDocumentTabs } from "./tabs/use-document-tabs";

type Flags = Readonly<Record<string, boolean>>;
interface Answer { readonly scopeKey: string; readonly flags: Flags }
interface Target { readonly scopeKey: string; readonly organizationId: string; readonly bridge: RendererBridge; readonly sessionGeneration: string }

/** Where a cloud format stands for one organization: allowed, switched off, or not known (no answer yet / failed). */
export type OfficeFlagStatus = "on" | "off" | "unknown";

/** How long a cloud open waits for an in-flight flags fetch before it fails closed. */
const FLAGS_WAIT_MS = 3_000;
/** After a failed read: 10 s, 20 s, 40 s ... capped at 5 min, until an answer arrives. */
const RETRY_BASE_MS = 10_000;
const RETRY_MAX_MS = 5 * 60_000;

/** One config read, retried once when the call throws. A malformed answer is not retried here. */
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
 * organization. A failed read is asked again later (backoff, and at once on
 * window focus / back online, and before a cloud open), so a transient outage
 * does not leave the session read-only (UNI-954 R4-1). Local files are never
 * gated by server flags.
 */
export function useOfficeFlags(bridge: RendererBridge, input: { enabled: boolean; sessionGeneration: string; accountKey: string | undefined; organizationId: string | undefined; reload: number }) {
  const { enabled, sessionGeneration, accountKey, organizationId, reload } = input;
  const scopeKey = enabled && organizationId ? `${accountKey ?? ""}|${organizationId}` : null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const latest = useRef<Answer | null>(null);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const currentOrganization = useRef(organizationId);
  currentOrganization.current = organizationId;
  const target = useRef<Target | null>(null);
  const run = useRef<{ readonly id: number; readonly pending: Promise<void> } | null>(null);
  const runs = useRef(0);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Starts a read for the current scope, or joins the one in flight. */
  const fetchNow = useCallback((): Promise<void> | null => {
    const scope = target.current;
    if (!scope) return null;
    if (run.current) return run.current.pending;
    clearTimeout(retryTimer.current);
    const id = ++runs.current;
    const pending = fetchFlags(scope.bridge, scope.sessionGeneration, scope.organizationId).then((flags) => {
      if (run.current?.id !== id) return;
      run.current = null;
      if (flags) {
        failures.current = 0;
        latest.current = { scopeKey: scope.scopeKey, flags };
        setAnswer(latest.current);
        return;
      }
      // A failed reload keeps the previous answer of the same scope; only an unanswered scope keeps asking.
      if (latest.current?.scopeKey === scope.scopeKey) return;
      failures.current += 1;
      retryTimer.current = setTimeout(() => { void fetchNow(); }, Math.min(RETRY_BASE_MS * 2 ** (failures.current - 1), RETRY_MAX_MS));
    });
    run.current = { id, pending };
    return pending;
  }, []);

  useEffect(() => {
    if (!organizationId || scopeKey === null) return undefined;
    target.current = { scopeKey, organizationId, bridge, sessionGeneration };
    run.current = null;
    failures.current = 0;
    void fetchNow();
    return () => {
      // A result for this scope that lands later is dropped (its run id no longer matches).
      target.current = null;
      run.current = null;
      clearTimeout(retryTimer.current);
    };
  }, [bridge, sessionGeneration, scopeKey, organizationId, reload, fetchNow]);

  useEffect(() => {
    const wake = () => { if (target.current && latest.current?.scopeKey !== target.current.scopeKey) void fetchNow(); };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => { window.removeEventListener("focus", wake); window.removeEventListener("online", wake); };
  }, [fetchNow]);

  const flags = answer?.scopeKey === scopeKey ? answer.flags : null;
  /**
   * Reads the newest answer, not the render it was created in, and only for the
   * organization the document belongs to: a document from another organization
   * than the current scope (an org switch during its open) reads unknown, so it
   * fails closed (UNI-954 R4-5).
   */
  const status = useCallback((format: string, documentOrganizationId: string): OfficeFlagStatus => {
    if (currentOrganization.current !== documentOrganizationId) return "unknown";
    const known = latest.current?.scopeKey === currentScope.current ? latest.current.flags : null;
    if (known === null) return "unknown";
    return officeFlagsAllow(known, format) ? "on" : "off";
  }, []);
  const settled = useCallback(async (): Promise<void> => {
    const scope = target.current;
    const answered = scope !== null && latest.current?.scopeKey === scope.scopeKey;
    // No answer yet and nothing in flight (the last read failed): ask again before the open.
    const pending = run.current?.pending ?? (answered ? null : fetchNow());
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([pending, new Promise<void>((resolve) => { timer = setTimeout(resolve, FLAGS_WAIT_MS); })]);
    clearTimeout(timer);
  }, [fetchNow]);
  return { flags, status, settled };
}

/**
 * Cloud tabs that opened read-only only because no flags were known yet (or the
 * flags said no) become editable once an answer allows their format. Only a tab
 * that never went dirty is upgraded: a read-only surface cannot edit, and an
 * upgrade swaps its session, so a dirty one is left alone. The editable session
 * is built from a fresh read of the document (`reopen`), never from the bytes
 * captured when the tab first opened, so a document that changed meanwhile is
 * not edited from a stale base (UNI-954 R4-2). A failed re-read leaves the tab
 * read-only and gated; the next answer tries again.
 */
export function useFlagGatedTabs(tabs: ReturnType<typeof useDocumentTabs>, officeFlags: ReturnType<typeof useOfficeFlags>, reopen: (tab: TabDocument) => Promise<CloudReopen | null>) {
  const gated = useRef(new Set<string>());
  const upgrading = useRef(new Set<string>());
  const { flags, status } = officeFlags;
  useEffect(() => {
    if (flags === null) return;
    for (const id of [...gated.current]) {
      const tab = tabs.current.current.tabs.find((entry) => entry.id === id);
      if (!tab) { gated.current.delete(id); continue; }
      if (upgrading.current.has(id) || status(tab.format, tab.data.identity.organizationId) !== "on") continue;
      upgrading.current.add(id);
      void reopen(tab.data).catch(() => null).then((fresh) => {
        upgrading.current.delete(id);
        // Re-check after the read: the tab may have closed, or the answer turned it off again.
        const live = tabs.current.current.tabs.find((entry) => entry.id === id);
        if (!fresh || !live || status(live.format, live.data.identity.organizationId) !== "on") return;
        if (tabs.upgradeCloud(id, fresh)) gated.current.delete(id);
      });
    }
  // The tab set is read through its live ref; this only reacts to a new answer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);
  return (documentId: string) => { gated.current.add(documentId); };
}
