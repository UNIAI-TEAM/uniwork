// G8-19 (UNI-1414) app driver: CDP on the Electron shell and its editor pages.
// Contract: g8-contract.md §7. Every app-side name it evaluates is a preload
// API of fork 7d665a54, cited where it is listed below.

/**
 * `window.uniworkComments.*` calls (fork packages/electron-utils/src/comments-bridge.ts:34-44,72;
 * channels comments-ipc.ts:25-48). `reveal`/`revealPending`/`saved` are push channels, not calls.
 */
export const COMMENTS_API_NAMES = Object.freeze([
  "list",
  "create",
  "update",
  "remove",
  "resolve",
  "reopen",
  "revisions",
  "anchors",
  "searchMentions",
  "context",
]);

/**
 * `window.uniworkDiscussion.*` calls on the shell page (fork packages/electron-utils/src/discussion-bridge.ts:20-28;
 * channels comments-ipc.ts:346-365). `onReveal`/`setPanel` are not request calls.
 */
export const DISCUSSION_API_NAMES = Object.freeze([
  "list",
  "create",
  "update",
  "remove",
  "resolve",
  "reopen",
  "revisions",
  "searchMentions",
]);

/** `window.aiOffice.*` calls a row module may make (fork apps/shell/src/preload/index.ts:549-1065). */
export const SHELL_API_NAMES = Object.freeze([
  "accountStatus",
  "accountLogin",
  "accountLogout",
  "accountSelectOrg",
  "uniworkCloudStatus",
  "uniworkListWorkspaces",
  "uniworkListDocuments",
  "uniworkListSharedWithMe",
  "uniworkDocumentProperties",
  "uniworkCreateDocument",
  "uniworkRenameDocument",
  "uniworkArchiveDocument",
  "uniworkRestoreDocument",
  "uniworkOpenDocument",
  "uniworkDocStatus",
  "uniworkActiveDocStatus",
  "uniworkSave",
]);

const EDITOR_KINDS = ["docs", "sheets", "slides", "pdf"];

/** The editor kind a page URL belongs to (`genoffice-app://sheets/...` -> "sheets"), or null. */
export function editorKindOfUrl(url) {
  const text = String(url ?? "");
  const scheme = text.match(/^genoffice-app:\/\/([a-z]+)\b/);
  if (scheme && EDITOR_KINDS.includes(scheme[1])) return scheme[1];
  for (const kind of EDITOR_KINDS) {
    if (new RegExp(`/(?:apps/)?${kind}/(?:[^/]*/)*index\\.html`).test(text)) return kind;
  }
  return null;
}

/** STEP 1 stub: the signature is final (contract §7), the body lands with T1 STEP 2. */
export async function connectApp(_opts) {
  throw new Error("connectApp: not implemented yet (UNI-1414 T1 step 2)");
}
