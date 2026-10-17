// G7-08 (UNI-1385) w2e2: the edit rows' tail of the web driver - undo/redo through the frame,
// the double Save, and the old version read again after the Save (review r2: G708-R2-1, R2-3,
// R2-4, R2-5, R2-6). The decisions are the pure helpers of save-observe.mjs; this module only
// drives the page and the API, and every IO step is injectable so the order and the BLOCKED
// mapping are unit-tested without a browser (G708-R2-9).

import { listVersions } from '../g7-04/cross-host.mjs';
import { sleep } from '../harness/app-steps.mjs';
import { webSave } from '../harness/web.mjs';
import { blockedVerdict, failVerdict } from './oracles.mjs';
import {
  buildEditSaveObservation, buildUndoRedoObserved, observeOldVersionAfterSave,
  readFrameHead, readVersionBytes, readVersionCount,
} from './save-observe.mjs';

// The text surface of a module frame (TipTap / ProseMirror for docs, CodeMirror for markdown and
// html), outside the AI dock. Canvas modules have none: the host dirty flag speaks for them.
const EDITOR_SELECTOR = '.ProseMirror, .cm-content';
const AI_CHROME_SELECTOR = '.ai-panel, .ai-dock, .ai-composer, .ai-chat, .copilot';
const UNDO_SETTLE_MS = 500;
// The second Save answers as fast as the first; a shorter bound keeps a lost one from costing the full row bound.
const SECOND_SAVE_BOUND_MS = 15_000;

/** The text of the frame's editor surface, or null when the module has none. */
export async function readEditorText(frame) {
  return frame.evaluate(({ editor, chrome }) => {
    const el = [...document.querySelectorAll(editor)].find((e) => !e.closest(chrome));
    return el ? (el.innerText ?? el.textContent ?? '') : null;
  }, { editor: EDITOR_SELECTOR, chrome: AI_CHROME_SELECTOR }).catch(() => null);
}

async function focusEditor(frame) {
  await frame.evaluate(({ editor, chrome }) => {
    const el = [...document.querySelectorAll(editor)].find((e) => !e.closest(chrome));
    el?.focus();
  }, { editor: EDITOR_SELECTOR, chrome: AI_CHROME_SELECTOR }).catch(() => {});
}

export const readHostDirty = (page, hostSelector) =>
  page.$eval(hostSelector, (el) => el.hasAttribute('data-dirty')).catch(() => null);

/** The host's own view after a Save: dirty flag and save state (office-module-frame.tsx:337-338). */
export const readHostState = (page, hostSelector) =>
  page.$eval(hostSelector, (el) => ({ dirty: el.hasAttribute('data-dirty'), saveState: el.getAttribute('data-save-state') }))
    .catch(() => ({ dirty: null, saveState: null }));

/**
 * R2-5: undo the AI change, then redo it, through the frame. Undo clicks the AI panel's undo
 * control when it is there, else presses the editor's own shortcut; redo is the editor shortcut
 * (docs frame: the "redo" command, shift+mod+z / mod+y). What is returned is what the page then
 * showed, never what was clicked.
 */
export async function driveUndoRedo({ page, frame, hostSelector, undoSelector, textBeforeTurn }) {
  const textAfterEdit = await readEditorText(frame);
  const dirtyAfterEdit = await readHostDirty(page, hostSelector);
  const undoBtn = await frame.$(undoSelector);
  const editorFound = textAfterEdit !== null;
  const undoControl = Boolean(undoBtn) || editorFound;
  const redoControl = editorFound;
  if (!undoControl || !redoControl) {
    return { ...buildUndoRedoObserved({ undoControl, redoControl }), dirtyAfterEdit };
  }

  if (undoBtn) await undoBtn.click();
  else { await focusEditor(frame); await page.keyboard.press('Control+z'); }
  await sleep(UNDO_SETTLE_MS);
  const textAfterUndo = await readEditorText(frame);
  const dirtyAfterUndo = await readHostDirty(page, hostSelector);

  await focusEditor(frame);
  await page.keyboard.press('Control+Shift+z');
  await sleep(UNDO_SETTLE_MS);
  const textAfterRedo = await readEditorText(frame);
  const dirtyAfterRedo = await readHostDirty(page, hostSelector);

  return {
    ...buildUndoRedoObserved({
      contentChanged: editorFound ? textBeforeTurn !== null && textAfterEdit !== textBeforeTurn : null,
      dirtyAfterEdit: dirtyAfterEdit === true,
      undoReverted: editorFound ? textAfterUndo === textBeforeTurn : dirtyAfterUndo === false,
      redoRestored: editorFound ? textAfterRedo === textAfterEdit : dirtyAfterRedo === true,
      undoControl,
      redoControl,
    }),
    dirtyAfterEdit,
    undoVia: undoBtn ? 'ai-panel-control' : 'editor-shortcut',
  };
}

const realIo = Object.freeze({
  driveUndoRedo, webSave, readFrameHead, readVersionBytes,
  readVersionCount: (args) => readVersionCount(listVersions, args),
  readHostDirty, readHostState, sleep,
});

/**
 * The edit rows after the AI turn: undo/redo, Save, a real second Save, the old version bytes.
 * Resolves `{ stop }` - a finished verdict (missing F selector, FAIL, or BLOCKED) - or `{ observed }`,
 * the scored fields and artifact bytes for `oracleVersionAndSave` / the format oracle.
 *
 * ctx: { row, page, frame, sel, undoSelector, apiOrigin, fetchImpl, documentId, token, timeoutMs,
 *   textBeforeTurn, headAfterAiTurn, versionsAfterAiTurn, commitBases }. `commitBases` is every
 *   `base_revision` the page's commit POSTs carried after the AI turn, in order.
 */
export async function runEditStage(ctx, io = realIo) {
  const { row, page, frame, sel, apiOrigin, fetchImpl, documentId, token, timeoutMs, headAfterAiTurn } = ctx;
  const api = { apiOrigin, fetchImpl, documentId, token };

  const undoRedo = await io.driveUndoRedo({
    page, frame, hostSelector: sel.host, undoSelector: ctx.undoSelector, textBeforeTurn: ctx.textBeforeTurn,
  });
  if (undoRedo.missingControl) {
    return { stop: { missingSelector: undoRedo.missingControl === 'undo' ? ctx.undoSelector : 'redo control (editor surface for the redo shortcut)' } };
  }
  if (!undoRedo.aiChangeUndoableBeforeSave) {
    // The change did not survive undo then redo; saving now would write the wrong document.
    return { stop: failVerdict('ai_change_not_undoable_before_save', { undoRedo }) };
  }

  const first = await io.webSave(page, { kind: row.module, timeoutMs });
  if (first.status !== 'saved') return { stop: failVerdict('web_save_failed_after_ai_edit', { saved: first }) };
  const afterFirst = await io.readVersionCount(api);
  if (!afterFirst.ok) return { stop: blockedVerdict(afterFirst.reason, { detail: afterFirst.detail, step: 'after_first_save' }) };
  // Evidence for the second Save's answer: what the host and the server held between the two Saves.
  const hostAfterFirst = await io.readHostState(page, sel.host);
  const headAfterFirst = await io.readFrameHead(api);

  const second = await io.webSave(page, { kind: row.module, timeoutMs: Math.min(timeoutMs, SECOND_SAVE_BOUND_MS) });
  const afterSecond = await io.readVersionCount(api);
  if (!afterSecond.ok) return { stop: blockedVerdict(afterSecond.reason, { detail: afterSecond.detail, step: 'after_second_save' }) };
  const headAfterSave = await io.readFrameHead(api);

  const obs = buildEditSaveObservation({
    doubleSave: { presses: 2, first, second },
    versionsAfterFirstSave: afterFirst.count,
    versionsAfterSecondSave: afterSecond.count,
    revisionAfterAiTurn: headAfterAiTurn.revision,
    lastCommitBaseRevision: ctx.commitBases[0] ?? null,
  });
  if (!obs.ok) {
    const { ok, reason, ...rest } = obs;
    return { stop: reason === 'web_save_failed_after_ai_edit' ? failVerdict(reason, rest) : blockedVerdict(reason, rest) };
  }

  const old = await observeOldVersionAfterSave({
    readBytes: (version) => io.readVersionBytes({ ...api, version }),
    version: headAfterAiTurn.version,
  });
  if (!old.ok) return { stop: blockedVerdict(old.reason, { detail: old.detail }) };

  return {
    observed: {
      ...obs.observed,
      aiChangeVisibleBeforeSave: undoRedo.aiChangeVisibleBeforeSave,
      aiChangeUndoableBeforeSave: undoRedo.aiChangeUndoableBeforeSave,
      revisionAfterSave: headAfterSave.revision,
      oldVersionSha256: old.sha256,
      afterBytes: headAfterSave.bytes,
      afterSha256: headAfterSave.sha256,
    },
    oldBytes: old.bytes,
    details: {
      saves: {
        first: { versionId: first.versionId, revision: headAfterFirst.revision, sha256: headAfterFirst.sha256, host: hostAfterFirst },
        second: { status: second.status, versionId: second.versionId ?? null, revision: headAfterSave.revision, sha256: headAfterSave.sha256 },
        bytesIdenticalAcrossSaves: headAfterFirst.sha256 === headAfterSave.sha256,
      },
      versionsAfterFirstSave: afterFirst.count,
      undoRedo: { via: undoRedo.undoVia ?? null, visible: undoRedo.aiChangeVisibleBeforeSave, undoable: undoRedo.aiChangeUndoableBeforeSave },
      oldVersion: old.version,
    },
  };
}
