import type { OfficeFrameSourceToken, OfficeFrameToken } from "@uniwork/core/api/endpoints/office-frame";
import type { DocumentLimits } from "@uniwork/core/api/endpoints/config";
import { docsFrameApiBase } from "@uniwork/core/office/docs-frame-api";
import { DocsProtocolError, type InitPayload, type OfficeModule, type TokenPayload } from "@uniwork/core/office/docs-frame-protocol";
import { getOfficeDraftKey, officeDraftScope } from "@uniwork/core/office/draft-session-key";
import { officeModuleSpec } from "@uniwork/core/office/office-modules";
import { officeModuleCapabilities, officeSourceCapabilities, toFrameLimits, type DocsFrameSessionOptions } from "./docs-frame-session-model";
import { frameDownloadMaxBytes } from "./frame-download";

/**
 * The `init` payload one frame handshake carries, built from the values current at that moment.
 * `lockedOut` and `downloadMaxBytes` are what the session remembers about this init (the
 * re-attach on a late lock, and the cap `api.download` enforces).
 */
export async function composeFrameInit(args: {
  module: OfficeModule;
  frameToken: TokenPayload;
  current: DocsFrameSessionOptions;
  doc: string;
  name: string;
  uid: string;
  minted: OfficeFrameToken | OfficeFrameSourceToken | null | undefined;
  /** A file from another module (UNI-1869): view-only by construction, no edit lock, no author identity. */
  source: boolean;
  /** The page's edit lock, already null for a source. */
  editLock: DocsFrameSessionOptions["editLock"] | null;
  limits: Pick<DocumentLimits, "upload_max_bytes" | "save_warn_ratio">;
  /** The page learnt the document is shelved (ARCHIVE-01 §3): another reason for the readOnly profile. */
  shelved?: boolean;
}): Promise<{ init: Omit<InitPayload, "protocolVersion">; lockedOut: boolean; downloadMaxBytes: number }> {
  const { module, frameToken, current, doc, name, uid, minted, source, editLock } = args;
  // The server derives the module from the stored file; a frame mounted for another
  // module would edit bytes of a format it does not own (older servers send none).
  if (minted?.module && minted.module !== module) {
    throw new DocsProtocolError({
      code: "malformed", message: `token is for module ${minted.module}, frame is ${module}`,
      details: { tokenModule: minted.module, expectedModule: module },
    });
  }
  // Same rule as the hook's viewOnly / copyRefused, read from the token this init carries.
  // `readonly` and `can_edit === false` are the readOnly profile only for a true viewer
  // (RFH-1, SVH-1): a document level of `comment` may not save but still comments
  // (init.commentsLevel), so it keeps `save: false` without the profile; any other or
  // unknown level is a viewer. A source is view-only by construction, whatever the level.
  // Shelving is another unconditional reason (ARCHIVE-01 §3): a shelved document's token
  // says can_edit=false for every module, Docs included, and a session shelved mid-way
  // keeps the flag so a re-attach composes the same read-only profile.
  const lockedOut = editLock != null && !editLock.held;
  const levelViewer = (current.readonly || minted?.can_edit === false) && current.myLevel !== "comment";
  const readOnlyProfile = source || args.shelved || levelViewer;
  const viewOnly = readOnlyProfile || current.readonly || minted?.can_edit === false || args.shelved || lockedOut;
  // copyRefused does not include shelved: the server's CopyDocument accepts a shelved source.
  const copyRefused = source || levelViewer || minted?.can_edit !== true;
  // Draft recovery (CONTRACT C18): the session's key, again on every init so a reloaded
  // frame reads the drafts it wrote. A viewer has nothing unsaved to recover.
  const recovery = officeModuleSpec(module).recovery === true && uid && !viewOnly
    ? { key: await getOfficeDraftKey(uid), scope: officeDraftScope(uid, doc) }
    : null;
  const capabilities = source
    ? officeSourceCapabilities(module, current.api)
    : officeModuleCapabilities(module, viewOnly, current.api, minted && "ai" in minted ? minted.ai : undefined, Boolean(current.onAppOpen), minted?.can_edit === true, copyRefused);
  const limits = toFrameLimits(args.limits);
  const downloadMaxBytes = frameDownloadMaxBytes(limits.max_bytes);
  const init: Omit<InitPayload, "protocolVersion"> = {
    ...frameToken,
    documentId: doc, workspaceId: current.wsId,
    apiBase: docsFrameApiBase(), apiMode: "host-proxy",
    locale: current.locale, theme: current.theme,
    capabilities,
    limits,
    ...(readOnlyProfile ? { profile: "readOnly" } : {}),
    // The cap api.download enforces, told up front so the conflict dialog can disable its
    // download choice before a 413; only with the capability (the frame ignores it otherwise).
    ...(capabilities.download ? { downloadMaxBytes } : {}),
    ...(name && !source ? { user: { displayName: name } } : {}),
    ...(recovery ? { recovery } : {}),
  };
  return {
    init: current.comments ? current.comments.augmentInit(init, { canEdit: minted?.can_edit, readonly: readOnlyProfile }) : init,
    lockedOut,
    downloadMaxBytes,
  };
}
