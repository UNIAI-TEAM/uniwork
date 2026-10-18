"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@uniwork/core/auth";
import { useFlag } from "@uniwork/core/feature-flags";
import { documentKeys } from "@uniwork/core/documents/keys";
import { useDocumentLimits } from "@uniwork/core/documents/limits";
import { officeFrameKeys, useOfficeFrameSourceToken, useOfficeFrameToken } from "@uniwork/core/documents/office-frame-hooks";
import type { OfficeFrameSourceToken, OfficeFrameToken } from "@uniwork/core/api/endpoints/office-frame";
import { docsFrameToken, type DocsFrameSavedAs } from "@uniwork/core/office/docs-frame-api";
import { createDocsFrameHost, type DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import { DocsProtocolError, type FileMeta, type FrameRequests, type ProtocolErrorShape, type TokenPayload } from "@uniwork/core/office/docs-frame-protocol";
import {
  armWatchdog,
  attachFrameBundleProbe,
  lockAwareSave,
  onSizeEvents,
  postDocDownload,
  readOnly,
  saveBlockedMaxBytes,
  saveCopyHandler,
  shapeOf,
  toFrameLimits,
  unauthorized,
  type DocsFrameBundleFailure,
  type DocsFrameSaveBlocked,
  type DocsFrameSaveOutcome,
  type DocsFrameSaveState,
  type DocsFrameSession,
  type DocsFrameSessionOptions,
  type DocsFrameSizeWarning,
  type DocsFrameStatus,
  hostSaveCauseError,
  type FrameLife,
  type HostSaveWatch,
} from "./docs-frame-session-model";
import { composeFrameInit } from "./docs-frame-init";
import { deliverFrameDownload, frameDownloadMaxBytes } from "./frame-download";
import { createFrameRemoteVersion, frameBlockError, openWithRevision, remoteAwareSave } from "./frame-remote-version";
import { createFrameApiProxy } from "./frame-api-proxy";
import { createFirstSaveGate } from "./first-save-gate";
import { useFrameRemote } from "./use-frame-remote-source";

/**
 * The host half of one Docs frame on the vendored protocol host: the token
 * handoff (`init`, `token.update` before expiry, `token.refresh`), the
 * `api.*` proxy, and the dirty / title / theme / language / resize wiring.
 */
export function useDocsFrameSession(options: DocsFrameSessionOptions): DocsFrameSession {
  const { iframeRef, frameOrigin, wsId, fileRef, locale, theme } = options;
  const module = options.module ?? "docs";
  // A file from another module (UNI-1869) mints on the workspace source route
  // and is view-only by construction: no write route accepts `ofs1.`.
  const isSource = fileRef.kind === "source";
  const fileId = fileRef.id;
  // Display data for the editors (comment and note authors), never an identity the frame authorises with.
  const displayName = useAuthStore((s) => s.user?.display_name ?? "");
  const userId = useAuthStore((s) => s.user?.id ?? "");
  const [attempt, setAttempt] = useState(0);
  const queryClient = useQueryClient();
  // The document the frame edits: the page's, until a save-as moves it to the copy.
  const [savedAs, setSavedAs] = useState<{ from: string; to: string } | null>(null);
  const scopeId = savedAs?.from === fileId ? savedAs.to : fileId;
  const docTokenQuery = useOfficeFrameToken(wsId, scopeId, { enabled: !isSource });
  const sourceTokenQuery = useOfficeFrameSourceToken(wsId, scopeId, { enabled: isSource });
  const tokenQuery = isSource ? sourceTokenQuery : docTokenQuery;
  const token = tokenQuery.data ? docsFrameToken(tokenQuery.data) : null;
  // A module other than Docs also honours the minted token's can_edit, so a view-only user is
  // treated as readonly even when the page did not say so (Docs keeps the page's readonly).
  // Not holding the page's edit lock (acquiring, someone else, lost) is view-only too (UNI-1645).
  // A source has no lock to hold: it is view-only already and never reads one.
  const editLock = isSource ? null : options.editLock;
  const lockedOut = editLock != null && !editLock.held;
  const viewOnly = isSource || options.readonly || (module !== "docs" && tokenQuery.data?.can_edit === false) || lockedOut;
  const copyRefused = isSource || options.readonly || tokenQuery.data?.can_edit === false;
  const editLockId = editLock?.held ? editLock.lockId : undefined;
  const [status, setStatus] = useState<DocsFrameStatus>("booting");
  const [slow, setSlow] = useState(false);
  const [fatal, setFatal] = useState<ProtocolErrorShape | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<DocsFrameSaveState>("ready");
  const [modal, setModal] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [host, setHost] = useState<DocsFrameHost | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [sizeWarning, setSizeWarning] = useState<DocsFrameSizeWarning | null>(null);
  const [saveBlocked, setSaveBlocked] = useState<DocsFrameSaveBlocked | null>(null);
  const syncFeed = useFlag("office_sync_feed", false);
  const documentLimits = useDocumentLimits();

  // Latest values for callbacks that live as long as the endpoint.
  const latest = useRef({ options, scopeId, token, refetch: tokenQuery.refetch, displayName, userId, viewOnly, copyRefused, syncFeed, editLock, editLockId, documentLimits, isSource, renameName: undefined as { id: string; name: string } | undefined });
  latest.current = { options, scopeId, token, refetch: tokenQuery.refetch, displayName, userId, viewOnly, copyRefused, syncFeed, editLock, editLockId, documentLimits, isSource, renameName: latest.current.renameName };
  // The current frame was initialised read-only because the lock was not held: holding it later
  // re-attaches the frame in edit mode (a read-only frame has nothing unsaved to lose).
  const initLockedOut = useRef(false);
  // New-version bookkeeping of the current endpoint (frame-remote-version.ts); a block outlives a retry.
  const { remoteRef, heldReasons, blocked, applyBlock } = useFrameRemote(wsId, isSource ? "" : scopeId, syncFeed);
  const sentToken = useRef<string | null>(null);
  // The Save the page has in flight, and whether the frame shows a dialog right now.
  const hostSave = useRef<HostSaveWatch | null>(null);
  const modalOpen = useRef(false);
  // The life of the endpoint the current effect created.
  const frameLife = useRef<FrameLife>({ state: "disposed" });
  // A clean frame after a save reads "saved"; one never saved reads "ready".
  const savedOnce = useRef(false);
  // The page's own Save (below, post-declaration): a declined frame save re-issues through it.
  const pageSave = useRef<((reason: "user" | "navigate") => Promise<DocsFrameSaveOutcome>) | null>(null);
  // UNI-1847 (SAVE-01): the one gate deciding a save names a never-saved blank first.
  const firstSaveGate = useRef(createFirstSaveGate({
    current: () => ({ firstSave: latest.current.options.firstSave, viewOnly: latest.current.viewOnly, savedOnce: savedOnce.current }),
  }));
  const sizeWarnedDoc = useRef<string | null>(null);
  const saveBlockedOpen = useRef(false);
  const downloadPending = useRef(false);
  const initDownloadMaxBytes = useRef<number>(frameDownloadMaxBytes(documentLimits.upload_max_bytes));

  useEffect(() => {
    setStatus("booting");
    setSlow(false);
    setFatal(null);
    setDirty(false);
    setSaveState("ready");
    setModal(false);
    setAiRunning(false);
    if (sizeWarnedDoc.current !== latest.current.scopeId) {
      sizeWarnedDoc.current = null;
      setSizeWarning(null);
    }
    saveBlockedOpen.current = false;
    downloadPending.current = false;
    setSaveBlocked(null);
    initDownloadMaxBytes.current = frameDownloadMaxBytes(latest.current.documentLimits.upload_max_bytes);
    modalOpen.current = false;
    sentToken.current = null;
    savedOnce.current = false;
    firstSaveGate.current.reset();
    const life: FrameLife = { state: "live" };
    frameLife.current = life;
    // `endpoint` is assigned below, before any frame can open anything to announce.
    const remote = createFrameRemoteVersion({
      // A source is not a documents row: there is no remote feed for it.
      documentId: latest.current.scopeId, enabled: () => latest.current.syncFeed && !latest.current.isSource,
      notify: (payload) => { if (life.state === "live") endpoint.notifyRemoteVersion(payload); },
      notifyBlocked: (payload) => { if (life.state === "live") endpoint.notifyBlocked(payload); },
    });
    remoteRef.current = remote;
    const iframe = iframeRef.current;
    // The frame failed for good (fatal error, failed handshake, a bundle that never started): show
    // the failure, and end a Save in flight with it, since nothing is left to answer it.
    const failSession = (failure: ProtocolErrorShape) => {
      setFatal(failure);
      setStatus("failed");
      if (life.state !== "live") return;
      life.state = "failed";
      modalOpen.current = false;
      setModal(false);
      setAiRunning(false);
      const watch = hostSave.current;
      if (watch?.life === life && !watch.cause) { watch.cause = "fatal"; watch.abort.abort(); }
    };
    // The frame document may never answer (404/5xx on index.html loads a dead page, and an iframe
    // fires no error event for that): until the handshake completes, a probe and a timer decide.
    let booted = false;
    const failBoot = (frameBundle: DocsFrameBundleFailure) => {
      if (booted) return;
      booted = true;
      failSession({
        code: frameBundle === "timeout" ? "timeout" : "internal",
        message: frameBundle === "timeout" ? "frame did not start in time" : "frame bundle could not be loaded",
        retryable: true,
        details: { frameBundle },
      });
    };

    const currentToken = async (): Promise<TokenPayload> => {
      const { options: { wsId: ws }, scopeId: doc, isSource: source } = latest.current;
      // The cache may hold a token this render has not seen yet.
      const cached = queryClient.getQueryData<OfficeFrameToken | OfficeFrameSourceToken | null>(
        source ? officeFrameKeys.sourceToken(ws, doc) : officeFrameKeys.token(ws, doc),
      );
      if (cached) return docsFrameToken(cached);
      // The first mint may still be in flight: join it rather than mint twice.
      const { data } = await latest.current.refetch({ cancelRefetch: false });
      if (!data) throw unauthorized();
      return docsFrameToken(data);
    };
    const proxy = createFrameApiProxy(latest, currentToken);

    const saveAs = proxy("api.saveAs", true, (api) => api.saveAs);
    const saveCopy = proxy("api.saveCopy", true, (api) => api.saveCopy);
    const open = proxy("api.open", false, (api) => api.open);
    const upload = proxy("api.save", true, (api) => api.save);
    // A 423 document_locked (addendum §11.1) is never {ok:false}: the page ends its hold (banner,
    // read-only) and the frame hears the same refusal the host gives a viewer, so it opens no
    // conflict dialog. Sending doc.editLock first waits for the protocol change (card c, Q4).
    const lockAware = lockAwareSave(upload, (fields) => latest.current.editLock?.onLocked(fields));
    const save = remoteAwareSave(lockAware, remote, applyBlock);
    // A save the frame starts (its button, Ctrl+S, the leave dialog) passes through here.
    // Once retry or unmount retired this endpoint, a late answer belongs to nobody: the session
    // that replaced it keeps its own state.
    const tracked = <T,>(run: () => Promise<T>, settled: (result: T) => DocsFrameSaveState) => {
      setSaveState("saving");
      return run().then(
        (result) => { if (life.state !== "disposed") setSaveState(settled(result)); return result; },
        (error: unknown) => {
          if (life.state === "disposed") throw error;
          const blockedMax = saveBlockedMaxBytes(error, latest.current.documentLimits.upload_max_bytes);
          if (blockedMax !== null && life.state === "live") {
            saveBlockedOpen.current = true;
            setSaveBlocked({ maxBytes: blockedMax });
          }
          // While the page's own Save is open its answer decides the header: a 409 here is the
          // frame's conflict dialog opening, not the end of that Save.
          if (hostSave.current) setSaveState("saving");
          // A save the user cancelled, or one the size dialog already explains, leaves the edits unsaved, not failed.
          else setSaveState(shapeOf(error).code === "cancelled" || blockedMax !== null ? "dirty" : "error");
          throw error;
        },
      );
    };
    // The frame's document went away (a reload or a crash): a Save sent to it can never be
    // answered, and a dialog it reported is gone with it.
    // Its edits are gone too (Markdown and HTML reload themselves after Reload latest): the next
    // document reports its own dirty state.
    const frameGone = () => {
      if (life.state !== "live") return;
      modalOpen.current = false;
      setModal(false);
      setDirty(false);
      // A turn of the gone document can no longer report its end.
      setAiRunning(false);
      const watch = hostSave.current;
      if (watch?.life === life && !watch.cause) { watch.cause = "unload"; watch.abort.abort(); }
    };
    // The same-origin frame document that completed the handshake. Its window's pagehide is the
    // moment it goes away (navigation, reload, the iframe leaving the page), whether or not a
    // replacement ever loads. A frame that cannot be inspected falls back to loads and handshakes.
    let frameDoc: Document | null = null;
    let frameDocGone = false;
    let unbindFrameDoc: (() => void) | null = null;
    const docGone = () => {
      if (frameDocGone) return;
      frameDocGone = true;
      frameGone();
    };
    const bindFrameDocument = () => {
      unbindFrameDoc?.();
      unbindFrameDoc = null;
      frameDoc = null;
      frameDocGone = false;
      let win: Window | null = null;
      try {
        win = iframe?.contentWindow ?? null;
        frameDoc = win?.document ?? null;
      } catch { frameDoc = null; return; /* not same-origin: loads and handshakes decide */ }
      if (!win || !frameDoc) return;
      const target = win;
      const doc = frameDoc;
      const onHide = () => { if (frameDoc === doc) docGone(); };
      target.addEventListener("pagehide", onHide);
      unbindFrameDoc = () => target.removeEventListener("pagehide", onHide);
    };
    const endpoint = createDocsFrameHost({
      self: window,
      frame: () => iframeRef.current?.contentWindow ?? null,
      allowedOrigins: [frameOrigin],
      module,
      getInit: async () => {
        const frameToken = await currentToken();
        sentToken.current = frameToken.token;
        const { options: current, scopeId: doc, displayName: name, userId: uid, documentLimits: limits, isSource: source, editLock: lock } = latest.current;
        const minted = queryClient.getQueryData<OfficeFrameToken | OfficeFrameSourceToken | null>(
          source ? officeFrameKeys.sourceToken(current.wsId, doc) : officeFrameKeys.token(current.wsId, doc),
        );
        const { init, lockedOut, downloadMaxBytes } = await composeFrameInit({ module, frameToken, current, doc, name, uid, minted, limits, source, editLock: lock });
        initLockedOut.current = lockedOut;
        initDownloadMaxBytes.current = downloadMaxBytes;
        return init;
      },
      refreshToken: async () => {
        const { data } = await latest.current.refetch();
        if (!data) throw unauthorized();
        const fresh = docsFrameToken(data);
        sentToken.current = fresh.token;
        return fresh;
      },
      api: {
        ...latest.current.options.comments?.api,
        "api.open": (payload, context) =>
          openWithRevision(
            async () => ({ ...(await open(payload, context)), limits: toFrameLimits(latest.current.documentLimits) }),
            payload,
            remote,
            context.signal,
          ).catch((error: unknown) => { const shape = shapeOf(error); if (latest.current.isSource && shape.code !== "cancelled") failSession(shape); throw error; }),
        "api.save": async (payload, context) => {
          // UNI-1847 (SAVE-01, D4 + S01-V2): a frame save of a still-unnamed blank is declined
          // at once and the page names the document, then sends the Save itself. The pinned
          // frame has no silent cancel shape - every api.save answer that is not ok/conflict/
          // too_large lands in the status bar as "Lưu thất bại" (bundle: hEe maps cancelled to
          // webSaveFailedGeneric), and its api.save request times out at No.transfer (120 s),
          // so holding the answer while the dialog is open cannot help either.
          const declined = firstSaveGate.current.declineFrameSave(() => void pageSave.current?.("user"));
          if (declined) return declined;
          // This upload belongs to the page's Save in flight: the watchdog waits for it.
          const watch = hostSave.current?.life === life ? hostSave.current : null;
          if (watch) { watch.busy += 1; armWatchdog(watch); }
          try {
            return await tracked(() => save(payload, context), (result) => {
              if (!result.ok) {
                const blockedMax = saveBlockedMaxBytes(result.error, latest.current.documentLimits.upload_max_bytes);
                if (blockedMax !== null && life.state === "live") {
                  saveBlockedOpen.current = true;
                  setSaveBlocked({ maxBytes: blockedMax });
                }
                return "dirty";
              }
              savedOnce.current = true;
              if (watch) watch.stored = true;
              return "saved";
            });
          } finally {
            // Only the Save still open may wait again; one that already ended stays ended.
            if (watch) { watch.busy -= 1; if (hostSave.current === watch) armWatchdog(watch); }
          }
        },
        "api.saveAs": async (payload, context) => {
          if (remote.blocked) throw frameBlockError(remote.blocked);
          const name = latest.current.options.copyName?.(payload.name) ?? payload.name;
          const { save: saved, rebind } = (await tracked(() => saveAs({ ...payload, name }, context), () => "saved")) as unknown as DocsFrameSavedAs;
          savedOnce.current = true;
          // Switch the frame to the copy before it hears the answer: token first, then scope.
          const { options: current } = latest.current;
          queryClient.setQueryData(officeFrameKeys.token(current.wsId, rebind.documentId), rebind.token);
          latest.current.scopeId = rebind.documentId;
          sizeWarnedDoc.current = null;
          setSizeWarning(null);
          saveBlockedOpen.current = false;
          setSaveBlocked(null);
          remote.rebind(rebind.documentId);
          if (saved.ok) remote.committed(saved.file, saved.versionId);
          setSavedAs({ from: current.fileRef.id, to: rebind.documentId });
          const frameToken = docsFrameToken(rebind.token);
          sentToken.current = frameToken.token;
          endpoint.pushToken(frameToken);
          // The copy now holds every byte the frame had: nothing is unsaved, so the page's own
          // navigation to the copy must not meet the leave dialog (the frame's dirty:false
          // event only arrives after this answer).
          setDirty(false);
          current.onSavedAs?.(rebind.documentId, name);
          return saved;
        },
        "api.saveCopy": saveCopyHandler({ remote, latest, queryClient, run: saveCopy }),
        "api.recents": proxy("api.recents", false, (api) => api.recents),
        "api.export": proxy("api.export", false, (api) => api.export),
        "api.attachments.add": proxy("api.attachments.add", true, (api) => api.addAttachments),
        "api.images.upload": proxy("api.images.upload", true, (api) => api.uploadImage),
        // A read of the user's own document, so a viewer may ask too.
        "api.assets.resolve": proxy("api.assets.resolve", false, (api) => api.resolveAssets),
        // The conflict dialog's "download my version": bytes only; name, type and size are the host's.
        "api.download": async (payload) => {
          const { options: current, scopeId: doc, viewOnly: refused, isSource: source } = latest.current;
          const minted = queryClient.getQueryData<OfficeFrameToken | OfficeFrameSourceToken | null>(
            source ? officeFrameKeys.sourceToken(current.wsId, doc) : officeFrameKeys.token(current.wsId, doc),
          );
          if (refused || minted?.can_edit !== true) { if (source) current.onSourceWriteRefused?.("write"); throw readOnly("api.download"); }
          return deliverFrameDownload(payload, module, current.downloadName?.() ?? doc, initDownloadMaxBytes.current);
        },
        "app.open": async () => {
          const { options: current, viewOnly: refused } = latest.current;
          return { outcome: refused || !current.onAppOpen ? "unavailable" : await current.onAppOpen() };
        },
      },
      // A new frame instance after the first: the old document and anything it had open are gone
      // (unless its pagehide said so already).
      onInitialized: (ack) => {
        if (booted && !frameDocGone) frameGone();
        booted = true;
        latest.current.options.comments?.attach(endpoint, ack, () => latest.current.scopeId);
        bindFrameDocument();
        // A block heard before this handshake (or by the frame instance before) reaches this one.
        remote.announceBlock();
        // A new document starts with no dialog open: it reports its own from here on.
        modalOpen.current = false;
        setModal(false);
        setAiRunning(false);
        setSlow(false);
        setStatus((now) => (now === "failed" ? now : "ready"));
      },
      onHandshakeError: (error) => {
        if (error.code === "cancelled") return;
        failSession(error.toShape());
      },
    });

    // A block outlives a retry; the frame hears it on its handshake (`announceBlock`).
    for (const reason of heldReasons()) remote.block(reason);

    endpoint.on("dirty", ({ dirty: next }) => {
      setDirty(next);
      // A failed save keeps "could not be confirmed" until the user edits again; the frame then
      // reports dirty, and the unsaved edits (not the old failure) are what the header must say.
      if (next) setSaveState((now) => (now === "error" ? "dirty" : now));
      else setSaveState((now) => (now === "dirty" ? (savedOnce.current ? "saved" : "ready") : now));
    });
    endpoint.on("modal", ({ open }) => {
      // A frame that failed, or whose document is known gone, has no dialog left to report: a
      // message queued before its teardown must not make the page inert with nothing to lift it.
      if (life.state !== "live" || frameDocGone) return;
      modalOpen.current = open;
      setModal(open);
      // A dialog the user reads stops the watchdog; one that closes without an answer restarts it.
      const watch = hostSave.current;
      if (watch) { watch.modal = open; armWatchdog(watch); }
    });
    // Per frame: only the live document that shook hands speaks for its turns.
    endpoint.on("aiRun", ({ state }) => { if (life.state === "live" && !frameDocGone) setAiRunning(state === "running"); });
    endpoint.on("title", ({ title }) => { latest.current.options.onTitle?.(title); });
    endpoint.on("resize", ({ height: next }) => { setHeight(next); });
    endpoint.on("saved", (saved) => {
      savedOnce.current = true;
      setSaveState("saved");
      const { options: { wsId: ws, onSaved }, scopeId: doc } = latest.current;
      void queryClient.invalidateQueries({ queryKey: documentKeys.detail(ws, doc) });
      onSaved?.(saved);
    });
    onSizeEvents(endpoint, {
      onSizeWarning: ({ bytes, max_bytes, warn_ratio }) => {
        if (life.state !== "live" || frameDocGone) return;
        const doc = latest.current.scopeId;
        if (sizeWarnedDoc.current === doc) return;
        sizeWarnedDoc.current = doc;
        setSizeWarning({ bytes, maxBytes: max_bytes, warnRatio: warn_ratio });
      },
      onSaveBlocked: ({ max_bytes }) => {
        if (life.state !== "live" || frameDocGone) return;
        saveBlockedOpen.current = true;
        setSaveBlocked({ maxBytes: max_bytes });
      },
    });
    endpoint.on("error", ({ error, fatal: isFatal }) => {
      if (isFatal) failSession(error);
      // A save conflict is answered inside the frame (its own Cancel / Reload / Overwrite dialog) and
      // reaches the host only as this event: a toast here would say it twice.
      if (error.code === "conflict" && !isFatal) return;
      if (error.code === "too_large" && !isFatal && saveBlockedOpen.current) return;
      latest.current.options.onError(error, { fatal: isFatal });
    });
    const detachProbe = attachFrameBundleProbe({
      iframe,
      frameSrc: latest.current.options.frameSrc,
      bootTimeoutMs: latest.current.options.bootTimeoutMs,
      slowAfterMs: latest.current.options.slowAfterMs,
      isBooted: () => booted,
      getFrameDoc: () => frameDoc,
      onSlow: () => setSlow(true),
      onDocGone: docGone,
      onFailBoot: failBoot,
    });
    setHost(endpoint);
    return () => {
      detachProbe();
      unbindFrameDoc?.();
      booted = true;
      // Retired at once: a Save still open here is cancelled by the dispose below, and nothing of
      // this endpoint may arm a timer or write state after this line.
      life.state = "disposed";
      latest.current.options.comments?.detach();
      const watch = hostSave.current;
      if (watch?.life === life && watch.timer !== null) { clearTimeout(watch.timer); watch.timer = null; }
      endpoint.dispose();
      if (remoteRef.current === remote) remoteRef.current = null;
      setHost(null);
    };
  }, [applyBlock, attempt, fileId, isSource, frameOrigin, heldReasons, iframeRef, module, queryClient, remoteRef, wsId]);

  // The lock arrived after the frame opened read-only ("Edit now", a handover, the first R2):
  // re-attach it in edit mode.
  const lockHeld = editLock?.held === true;
  useEffect(() => {
    if (!lockHeld || !initLockedOut.current) return;
    initLockedOut.current = false;
    setAttempt((n) => n + 1);
  }, [lockHeld]);

  // Proactive rotation: a re-minted token reaches the frame before the old one expires.
  const tokenValue = token?.token;
  useEffect(() => {
    const current = latest.current.token;
    if (!host || !current || sentToken.current === null || sentToken.current === current.token) return;
    sentToken.current = current.token;
    host.pushToken(current);
  }, [host, tokenValue]);

  // No-ops until the handshake; `getInit` reads the values current at that moment.
  useEffect(() => { host?.setTheme(theme); }, [host, theme]);
  useEffect(() => { host?.setLanguage(locale); }, [host, locale]);

  const save = useCallback(async (reason: "user" | "navigate"): Promise<DocsFrameSaveOutcome> => {
    // One Save at a time: a second one (the page is inert while the frame's dialog is open) is refused, unsent.
    const life = frameLife.current;
    if (!host || hostSave.current || life.state !== "live") return "failed";
    // UNI-1847 (SAVE-01, D2): a never-saved blank is named before its first upload. Cancel
    // answers "cancelled" (the edits stay, the header stays unsaved); the name written, the
    // same Save carries on - and every later one, the dialog never opens twice.
    const naming = firstSaveGate.current.pendingName();
    if (naming) {
      if (!(await firstSaveGate.current.pageAsk(naming))) return "cancelled";
      // The dialog may stay open a long time: a frame Save that joined it re-issued this Save
      // already, and the frame may have been retried or gone meanwhile.
      if (!host || hostSave.current || frameLife.current !== life || life.state !== "live") return "failed";
    }
    const watch: HostSaveWatch = { life, abort: new AbortController(), cause: null, settled: false, busy: 0, modal: modalOpen.current, stored: false, timer: null };
    hostSave.current = watch;
    armWatchdog(watch);
    setSaveState("saving");
    const fail = (error: ProtocolErrorShape): DocsFrameSaveOutcome => {
      const blockedMax = saveBlockedMaxBytes(error, latest.current.documentLimits.upload_max_bytes);
      // The size dialog already explains a blocked save: the header says unsaved, not "could not be confirmed".
      setSaveState(blockedMax !== null ? "dirty" : "error");
      if (blockedMax !== null) {
        saveBlockedOpen.current = true;
        setSaveBlocked({ maxBytes: blockedMax });
        return "failed";
      }
      if (error.code === "too_large" && saveBlockedOpen.current) return "failed";
      latest.current.options.onError(error, { fatal: false });
      return "failed";
    };
    try {
      // No request timeout: the frame's conflict dialog may stay open as long as the user reads it.
      const result = await host.save({ reason }, { timeoutMs: 0, signal: watch.abort.signal });
      if (result.ok) {
        // A new version (Overwrite, or a plain save) reads "saved"; Reload latest stores nothing and reads "ready".
        const stored = Boolean(result.versionId) || watch.stored;
        if (stored) savedOnce.current = true;
        setSaveState(stored ? "saved" : "ready");
        return stored ? "saved" : "reloaded";
      }
      // Only the frame's own Cancel is silent: the edits stay, unsaved.
      if (result.error.code === "cancelled") { setSaveState("dirty"); return "cancelled"; }
      return fail(result.error);
    } catch (error) {
      // The frame failed for good: its failure is already on screen (and reported once), and this Save ends with it.
      if (watch.cause === "fatal") { setSaveState("error"); return "failed"; }
      const caused = hostSaveCauseError(watch.cause);
      if (caused) return fail(caused);
      const shape = shapeOf(error);
      // The session itself went away (retry, unmount): nobody is left to tell, and the session
      // that replaced it keeps its own header.
      if (shape.code === "cancelled") { if (watch.life.state !== "disposed") setSaveState("dirty"); return "cancelled"; }
      return fail(shape);
    } finally {
      watch.settled = true;
      if (watch.timer !== null) clearTimeout(watch.timer);
      watch.timer = null;
      if (hostSave.current === watch) hostSave.current = null;
    }
  }, [host]);
  pageSave.current = save;

  const print = useCallback(async () => {
    if (!host) return false;
    try {
      return (await host.print({ mode: "dialog" }, { timeoutMs: 10 * 60_000 })).printed;
    } catch (error) {
      latest.current.options.onError(shapeOf(error), { fatal: false });
      return false;
    }
  }, [host]);

  const dismissSaveBlocked = useCallback(() => {
    saveBlockedOpen.current = false;
    setSaveBlocked(null);
  }, []);

  const downloadCopy = useCallback(() => {
    const life = frameLife.current;
    if (life.state !== "live" || downloadPending.current) return;
    downloadPending.current = true;
    void postDocDownload(iframeRef.current?.contentWindow ?? null, frameOrigin)
      .catch((error: unknown) => {
        if (life.state === "live") latest.current.options.onError(shapeOf(error), { fatal: false });
      })
      .finally(() => { downloadPending.current = false; });
  }, [frameOrigin, iframeRef]);

  const tokenFailure = !token && (tokenQuery.isError || (tokenQuery.isSuccess && tokenQuery.data === null)) ? shapeOf(tokenQuery.error ?? unauthorized()) : null;
  const failure = fatal ?? tokenFailure;
  const refetchToken = tokenQuery.refetch;
  const retry = useCallback(() => {
    if (tokenFailure) void refetchToken();
    setAttempt((n) => n + 1);
  }, [refetchToken, tokenFailure]);

  // The document's name changed on the page (the first-save dialog named it): the frame's
  // title bar and recents read the same name without waiting on a save (UNI-1847, D5) -
  // and the next save's upload carries that filename so the stored file follows (S01-V3).
  const notifyRenamed = useCallback((file: FileMeta) => {
    latest.current.renameName = { id: file.fileId, name: file.name };
    if (frameLife.current.state === "live") host?.notifyRenamed(file);
  }, [host]);
  return { status: failure ? "failed" : status, slow: slow && status === "booting" && !failure, viewOnly, failure, dirty,
    // Edits made after the last save (or during it) read as unsaved until the frame reports clean.
    saveState: dirty && saveState !== "saving" && saveState !== "error" ? "dirty" : saveState,
    modal: modal && status === "ready" && !failure,
    height, aiRunning: aiRunning && status === "ready" && !failure, blocked,
    sizeWarning: status === "ready" && !failure ? sizeWarning : null,
    saveBlocked: status === "ready" && !failure ? saveBlocked : null,
    dismissSaveBlocked, downloadCopy, save, print, notifyRenamed, attempt, retry };
}
