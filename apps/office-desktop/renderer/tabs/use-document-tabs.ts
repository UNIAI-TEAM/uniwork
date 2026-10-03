import { useEffect, useRef, useState } from "react";
import type { OfficeIdentity } from "@uniwork/core/office";
import type { DesktopDocumentFormat } from "../../shared/document-formats";
import type { RendererBridge } from "../app";
import { createByteDocumentSession, type ByteDocumentSession, type OpenedBytes } from "../office/session";
import { closeDocumentTab, cycleDocumentTab, openDocumentTab, selectDocumentTab, type DocumentTabState } from "./tab-model";

export interface OpenTabInput {
  readonly kind: "local" | "cloud";
  readonly identity: OfficeIdentity;
  readonly bytes: OpenedBytes;
  readonly title: string;
  readonly format: DesktopDocumentFormat;
}

export interface TabDocument extends OpenTabInput {
  readonly session: ByteDocumentSession;
}

export function isDocumentDirty(session: ByteDocumentSession): boolean {
  const state = session.coordinator.getState();
  return state.dirtyGeneration > state.lastSavedGeneration || state.state === "saving";
}

/** Editors and their coordinators survive selection changes; only close disposes. */
export function useDocumentTabs(bridge: RendererBridge) {
  const [state, setState] = useState<DocumentTabState<TabDocument>>({ tabs: [], activeTabId: null });
  const current = useRef(state);
  const [, redraw] = useState(0);
  const [checkpointFailures, setCheckpointFailures] = useState<readonly string[]>([]);
  const alive = useRef(true);
  const commit = (next: DocumentTabState<TabDocument>) => { current.current = next; setState(next); };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const tab of current.current.tabs) tab.data.session.dispose();
    };
  }, []);

  useEffect(() => {
    const release = state.tabs.map((tab) => tab.data.session.coordinator.subscribe(() => {
      redraw((value) => value + 1);
      // A confirmed save (or any transition to clean) retires a stale
      // "could not protect changes" warning immediately.
      if (!isDocumentDirty(tab.data.session)) setCheckpointFailures((previous) => previous.includes(tab.id) ? previous.filter((id) => id !== tab.id) : previous);
    }));
    return () => release.forEach((unsubscribe) => unsubscribe());
  }, [state.tabs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const tab of current.current.tabs) {
        if (!isDocumentDirty(tab.data.session)) {
          setCheckpointFailures((previous) => previous.includes(tab.id) ? previous.filter((id) => id !== tab.id) : previous);
          continue;
        }
        void tab.data.session.keepDraft().then((stored) => {
          if (!alive.current || !current.current.tabs.some((entry) => entry.id === tab.id)) return;
          setCheckpointFailures((previous) => stored ? previous.filter((id) => id !== tab.id) : previous.includes(tab.id) ? previous : [...previous, tab.id]);
        });
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, []);

  const summaries = state.tabs.map((tab) => ({ id: tab.id, title: tab.title, format: tab.format, dirty: isDocumentDirty(tab.data.session), saving: tab.data.session.coordinator.getState().state === "saving" }));
  return {
    ...state,
    current,
    checkpointFailures,
    summaries,
    cloudTabIds(): readonly string[] { return current.current.tabs.filter((tab) => tab.data.kind === "cloud").map((tab) => tab.id); },
    open(input: OpenTabInput): "opened" | "focused" | "limit" {
      const existing = current.current.tabs.find((tab) => tab.id === input.identity.documentId);
      if (existing) { commit(selectDocumentTab(current.current, existing.id)); return "focused"; }
      if (current.current.tabs.length >= 8) return "limit";
      const session = createByteDocumentSession(bridge, input.identity, input.bytes, {
        // Save As moves the document to a new handle: main rebinds its context
        // and the tab follows, so later saves and draft lookups use the new id.
        onLocalRebind: (next) => {
          const live = current.current;
          if (!live.tabs.some((tab) => tab.id === next.previousId)) return;
          commit({
            tabs: live.tabs.map((tab) => tab.id === next.previousId ? { ...tab, id: next.documentId, title: next.title, data: { ...tab.data, identity: next.identity, bytes: next.bytes } } : tab),
            activeTabId: live.activeTabId === next.previousId ? next.documentId : live.activeTabId,
          });
        },
      });
      const result = openDocumentTab(current.current, { id: input.identity.documentId, title: input.title, format: input.format, data: { ...input, session } });
      commit(result.state);
      return result.outcome;
    },
    select(id: string | null) { commit(selectDocumentTab(current.current, id)); },
    cycle(direction: 1 | -1) { commit(cycleDocumentTab(current.current, direction)); },
    close(id: string) {
      current.current.tabs.find((tab) => tab.id === id)?.data.session.dispose();
      commit(closeDocumentTab(current.current, id));
      setCheckpointFailures((previous) => previous.filter((entry) => entry !== id));
    },
    /** Account scope changes close cloud work only; local-device tabs stay. */
    closeCloud() {
      const wasActive = current.current.activeTabId;
      for (const tab of current.current.tabs) if (tab.data.kind === "cloud") tab.data.session.dispose();
      const tabs = current.current.tabs.filter((tab) => tab.data.kind !== "cloud");
      const activeTabId = wasActive !== null && tabs.some((tab) => tab.id === wasActive) ? wasActive : null;
      commit({ tabs, activeTabId });
      setCheckpointFailures((previous) => previous.filter((id) => tabs.some((tab) => tab.id === id)));
    },
    reset() {
      for (const tab of current.current.tabs) tab.data.session.dispose();
      commit({ tabs: [], activeTabId: null });
      setCheckpointFailures([]);
    },
  };
}
