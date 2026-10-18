// G7-08 (UNI-1385) w2e/w2f: the Save observation helpers of the web driver
// (review r2, findings G708-R2-1, R2-2, R2-3, R2-5, R2-6, R2-9; review r3,
// finding G708-R3-4). Pure by contract: no filesystem, no Playwright import -
// the driver feeds them what it saw, so every scored field is either measured
// or BLOCKED, never defaulted (contract w1b). The AI-turn wire observation of
// the same driver - the model routes, the usage readers and the passive real-run
// listener - lives in `wire-observe.mjs`.
//
// Settled field meanings (G708-R2-1; driver, builder and oracle agree):
//   versionsAfterFirstSave     - version count after the FIRST Save's commit.
//   versionsAfterSecondSave    - version count after the second Save of the same
//                                gesture settled. `versionsAfterSave` in the row
//                                observation is this count.
//   doubleClickVersionsCreated - versions the SECOND Save added
//                                (versionsAfterSecondSave - versionsAfterFirstSave):
//                                0 when the double click stays a single version,
//                                never the first Save's delta.

import { callTracerApi } from '../g7-10/tracer.mjs';
import { sha256Hex } from '../harness/fixture-files.mjs';

/**
 * R2-2: is this POST pathname a Save intent of the frame?
 * The host stages the bytes at `POST /api/v1/office-frame/documents/{id}/uploads`
 * and commits them at `.../versions/commit`
 * (server/internal/handler/router/office_frame.go:28,74,79; packages/core/office/docs-frame-api.ts:246,249);
 * the legacy version route `POST /api/v1/documents/{id}/versions` still exists.
 */
export function isSaveIntentPath(pathname) {
  const p = String(pathname ?? '');
  return (
    /\/office-frame\/documents\/[^/]+\/uploads$/.test(p) ||
    /\/versions\/commit$/.test(p) ||
    /\/documents\/[^/]+\/versions$/.test(p)
  );
}

/**
 * R2-3: the commit's `base_revision` out of the frame's own POST body, or null
 * when the body was absent, empty, not JSON, or carried no base - the caller
 * turns null into BLOCKED `missing_save_base_revision` (absent scored field).
 */
export function parseCommitBaseRevision(postData) {
  if (typeof postData !== 'string' || postData.trim() === '') return null;
  let body;
  try {
    body = JSON.parse(postData);
  } catch {
    return null;
  }
  const base = body?.base_revision;
  return base === undefined || base === null ? null : String(base);
}

/**
 * R2-6: one strict version count. `listVersions` (g7-04/cross-host.mjs) keeps its
 * own semantics; the g7-08 side asks for the strict form and turns the throw into
 * the row's BLOCKED reason - a 200 without a `versions` array is an absent scored
 * field, never a count of 0.
 */
export async function readVersionCount(listVersionsFn, args) {
  try {
    return { ok: true, count: await listVersionsFn({ ...args, strict: true }) };
  } catch (err) {
    return { ok: false, reason: 'missing_version_list', detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * R2-5: what undo, then redo, through the frame actually showed. `executedTools`
 * is deliberately not an input: a tool call that ran is not evidence that the
 * change is visible or undoable. `contentChanged` is null when the module has no
 * readable text surface (canvas editors), and then only the host's dirty flag
 * speaks. Visible = the change is there; undoable = undo took it away AND redo
 * brought it back.
 */
export function buildUndoRedoObserved({
  contentChanged, dirtyAfterEdit, undoReverted, redoRestored, undoControl, redoControl,
} = {}) {
  if (!undoControl || !redoControl) {
    return {
      aiChangeVisibleBeforeSave: false,
      aiChangeUndoableBeforeSave: false,
      missingControl: undoControl ? 'redo' : 'undo',
    };
  }
  const visible = contentChanged === true || dirtyAfterEdit === true;
  return {
    aiChangeVisibleBeforeSave: visible,
    aiChangeUndoableBeforeSave: visible && undoReverted === true && redoRestored === true,
    missingControl: null,
  };
}

/**
 * R2-1 + R2-3 + R2-9: the edit rows' Save observations from what the driver saw,
 * or the BLOCKED reason when a scored field is absent. `doubleSave` is what the
 * two Saves of one gesture answered. A second Save that is skipped or does not
 * answer `saved` is BLOCKED `missing_double_click_save`: the dry run showed the
 * frame commits a second Save even of a clean document, so a skipped one is a lost
 * Save, not a measured +0.
 */
export function buildEditSaveObservation({
  doubleSave = null, versionsAfterFirstSave, versionsAfterSecondSave,
  revisionAfterAiTurn, lastCommitBaseRevision,
} = {}) {
  if (!doubleSave || doubleSave.presses !== 2) {
    return { ok: false, reason: 'missing_double_click_save', detail: 'the second Save was not sent' };
  }
  if (doubleSave.first?.status !== 'saved') {
    return { ok: false, reason: 'web_save_failed_after_ai_edit', saved: doubleSave.first ?? null };
  }
  if (!Number.isInteger(versionsAfterFirstSave) || !Number.isInteger(versionsAfterSecondSave)) {
    return { ok: false, reason: 'missing_version_list', versionsAfterFirstSave, versionsAfterSecondSave };
  }
  if (doubleSave.second?.status !== 'saved') {
    return { ok: false, reason: 'missing_double_click_save', saved: doubleSave.second ?? null };
  }
  if (lastCommitBaseRevision === null || lastCommitBaseRevision === undefined) {
    return { ok: false, reason: 'missing_save_base_revision' };
  }
  return {
    ok: true,
    observed: {
      versionsAfterSave: versionsAfterSecondSave,
      doubleClickVersionsCreated: versionsAfterSecondSave - versionsAfterFirstSave,
      saveUsedCurrentBaseRevision: String(lastCommitBaseRevision) === String(revisionAfterAiTurn),
    },
  };
}

/** The frame's head (revision, current version) plus the bytes the content route serves. */
export async function readFrameHead({ apiOrigin, fetchImpl = fetch, documentId, token }) {
  const tokenRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'mintOfficeFrameToken', params: { documentID: documentId }, token });
  const frameToken = tokenRes.data?.token;
  if (!frameToken) throw new Error('mintOfficeFrameToken returned no token');
  const openRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'openOfficeFrameDocument', params: { documentID: documentId }, token: frameToken });
  const contentRes = await callTracerApi({
    apiOrigin, fetchImpl, name: 'getOfficeFrameDocumentContent', params: { documentID: documentId }, token: frameToken, expectBinary: true,
  });
  return {
    versionId: openRes.data?.file?.version_id ?? null,
    version: openRes.data?.file?.version ?? null,
    revision: openRes.data?.revision ?? null,
    bytes: new Uint8Array(contentRes.bytes),
    sha256: sha256Hex(contentRes.bytes),
  };
}

/**
 * R2-4: the bytes of one earlier file version, as the document owner downloads it
 * (`GET /api/v1/documents/{id}/download?version=N`, router/documents.go:224). The
 * frame's content route only serves the live version, so this is the one place
 * the old version is read again after a Save.
 */
export async function readVersionBytes({ apiOrigin, fetchImpl = fetch, documentId, token, version }) {
  const res = await callTracerApi({
    apiOrigin, fetchImpl, name: 'downloadDocument', params: { documentID: documentId }, query: { version }, token, expectBinary: true,
  });
  return { bytes: new Uint8Array(res.bytes), sha256: sha256Hex(res.bytes) };
}

/**
 * R2-4: re-read the previous version after the Save. A missing version number or a
 * failed GET is BLOCKED `missing_old_version_bytes_after_save`; the caller never
 * falls back to the pre-save head's hash as the "old version" evidence.
 */
export async function observeOldVersionAfterSave({ readBytes, version }) {
  const blocked = (detail) => ({ ok: false, reason: 'missing_old_version_bytes_after_save', detail });
  if (!Number.isInteger(version)) return blocked('the pre-save head carries no version number to read again');
  try {
    const { bytes, sha256 } = await readBytes(version);
    return { ok: true, bytes, sha256, version };
  } catch (err) {
    return blocked(err instanceof Error ? err.message : String(err));
  }
}
