import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { desktopLibraryDownloadResponseSchema, type DesktopLibraryDocument, type DesktopSessionMetadata } from "../../shared/ipc";
import type { RendererBridge } from "../app";
import { createLibraryController, createLibraryScopeController, type LibraryMode } from "./model";
import { LibraryView } from "./view";

const SESSION_GENERATION = "desktop-dev-session";
type Scope = DesktopSessionMetadata & { accountId: string; deploymentId: string; organizationId?: string; workspaceId?: string };

export function LibraryHost({ bridge, scope, onOpen, onCreate, onOpenLocal }: { bridge: RendererBridge; scope: Scope & { organizationId: string; workspaceId: string }; onOpen: (document: DesktopLibraryDocument) => void; onCreate: () => void; onOpenLocal: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [mode, setMode] = useState<LibraryMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<{ documents: DesktopLibraryDocument[]; engineAvailable: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [downloadError, setDownloadError] = useState(false);
  const scopeController = useMemo(() => createLibraryScopeController({ deploymentId: scope.deploymentId, accountId: scope.accountId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, sessionGeneration: SESSION_GENERATION }), [scope.accountId, scope.deploymentId, scope.organizationId, scope.workspaceId]);
  const controller = useMemo(() => createLibraryController(bridge, scopeController), [bridge, scopeController]);
  const drawSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestSequence = ++drawSequence.current;
    setResult(null);
    setError(false);
    const run = mode === "list" ? controller.list() : mode === "recent" ? controller.recent() : searchQuery.trim() ? controller.search(searchQuery.trim()) : Promise.resolve({ documents: [], nextCursor: null, engineAvailable: true, generation: 0 });
    void run
      .then((next) => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult({ documents: next.documents, engineAvailable: next.engineAvailable });
        setError(false);
      })
      .catch(() => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult(null);
        setError(true);
      });
    return () => { active = false; };
  }, [controller, mode, searchQuery, reload]);

  return (
    <>{downloadError ? <p role="alert" className="px-6 text-destructive">{t("actionError")}</p> : null}<LibraryView
      mode={mode}
      searchQuery={searchQuery}
      documents={result?.documents ?? []}
      engineAvailable={result?.engineAvailable ?? true}
      loading={result === null && !error}
      error={error}
      onRetry={() => setReload((value) => value + 1)}
      onModeChange={setMode}
      onSearch={setSearchQuery}
      onOpen={onOpen}
      onDownload={(document) => {
        setDownloadError(false);
        void bridge.call("desktop:library-download", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version }).then((raw) => {
          const result = desktopLibraryDownloadResponseSchema.parse(raw);
          const bytes = Uint8Array.from(atob(result.dataBase64), (character) => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
          const link = window.document.createElement("a"); link.href = url; link.download = result.filename;
          window.document.body.append(link); link.click(); link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }).catch(() => setDownloadError(true));
      }}
      onCreate={onCreate}
      onOpenLocal={onOpenLocal}
    /></>
  );
}

