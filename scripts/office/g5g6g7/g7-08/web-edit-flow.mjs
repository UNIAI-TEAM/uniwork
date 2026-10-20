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

// w2l: the module's own undo / redo ribbon controls. Every pinned module renders them as a
// `qa-btn` named by its locale (docs/sheets `appUndo`, slides `ribbonUndo`, html/markdown/pdf
// `undo`; pdf appends the shortcut, hence the prefix match). vi is the driver's locale, en the
// frame default. The AI panel's version rollback (`ai-version-rollback`) restores a snapshot - it is
// not the editor history - and is never driven here.
export const NATIVE_UNDO_SELECTOR = 'button.qa-btn[aria-label^="Hoàn tác"], button.qa-btn[aria-label^="Undo"]';
export const NATIVE_REDO_SELECTOR = 'button.qa-btn[aria-label^="Làm lại"], button.qa-btn[aria-label^="Redo"]';
const NATIVE_SELECTORS = Object.freeze({ undo: NATIVE_UNDO_SELECTOR, redo: NATIVE_REDO_SELECTOR });
// A canvas module walks its history until the control disables; the bound only stops a stuck control.
const MAX_HISTORY_STEPS = 25;

const nativeIo = Object.freeze({
  readEditorText, readHostDirty, focusEditor, sleep,
  async control(frame, which) {
    const handle = await frame.$(NATIVE_SELECTORS[which]);
    if (!handle) return { present: false, enabled: null };
    return { present: true, enabled: await handle.isEnabled().catch(() => null) };
  },
  async click(frame, which) {
    const handle = await frame.$(NATIVE_SELECTORS[which]);
    await handle?.click({ timeout: 5_000 });
  },
  async shortcut(page, which) {
    await page.keyboard.press(which === 'undo' ? 'Control+z' : 'Control+Shift+z');
  },
});

/**
 * R2-5 + w2l: undo the AI change with the editor's own undo, then redo it with the editor's own
 * redo, and report each half on its own (`undoReverted`, `redoRestored`) so a FAIL names the one
 * that failed. A control is the module's ribbon button when the frame shows one, else the editor
 * shortcut on a text surface; a module with neither is the only case that is "missing". Text
 * surfaces (docs / markdown / html) compare the editor text; canvas modules (sheets, slides, pdf)
 * have none, so they walk their own history - undo until the control disables, redo the same count
 * - and judge it by the controls' enabled state, with the host dirty flag kept as evidence. What is
 * returned is what the page then showed, never what was clicked.
 */
export async function driveUndoRedo({ page, frame, hostSelector, textBeforeTurn }, io = nativeIo) {
  const textAfterEdit = await io.readEditorText(frame);
  const dirtyAfterEdit = await io.readHostDirty(page, hostSelector);
  const editorFound = textAfterEdit !== null;
  const ribbon = { undo: await io.control(frame, 'undo'), redo: await io.control(frame, 'redo') };
  const via = (which) => (ribbon[which].present ? 'ribbon' : editorFound ? 'editor-shortcut' : null);
  const undoVia = via('undo');
  const redoVia = via('redo');
  const nativeUndoEnabledAfterEdit = ribbon.undo.present ? ribbon.undo.enabled === true : null;
  const undoControl = undoVia !== null;
  const redoControl = redoVia !== null;
  if (!undoControl || !redoControl) {
    return { ...buildUndoRedoObserved({ undoControl, redoControl }), dirtyAfterEdit, nativeUndoEnabledAfterEdit, undoVia, redoVia };
  }

  const step = async (which) => {
    if (ribbon[which].present) {
      const state = await io.control(frame, which);
      if (state.enabled !== true) return false;
      await io.click(frame, which);
    } else {
      await io.focusEditor(frame);
      await io.shortcut(page, which);
    }
    await io.sleep(UNDO_SETTLE_MS);
    return true;
  };
  const enabledNow = async (which) => (await io.control(frame, which)).enabled === true;

  let undoSteps = 0;
  let redoSteps = 0;
  const limit = editorFound ? 1 : MAX_HISTORY_STEPS;
  while (undoSteps < limit && await step('undo')) undoSteps += 1;
  const textAfterUndo = await io.readEditorText(frame);
  const dirtyAfterUndo = await io.readHostDirty(page, hostSelector);
  const redoEnabledAfterUndo = ribbon.redo.present ? await enabledNow('redo') : null;
  const undoEnabledAfterUndo = ribbon.undo.present ? await enabledNow('undo') : null;
  while (redoSteps < undoSteps && await step('redo')) redoSteps += 1;
  const textAfterRedo = await io.readEditorText(frame);
  const dirtyAfterRedo = await io.readHostDirty(page, hostSelector);
  const undoEnabledAfterRedo = ribbon.undo.present ? await enabledNow('undo') : null;
  const redoEnabledAfterRedo = ribbon.redo.present ? await enabledNow('redo') : null;

  const undoReverted = editorFound
    ? undoSteps > 0 && textAfterUndo === textBeforeTurn
    : undoSteps > 0 && undoEnabledAfterUndo === false && redoEnabledAfterUndo === true;
  const redoRestored = editorFound
    ? redoSteps > 0 && textAfterRedo === textAfterEdit
    : undoSteps > 0 && redoSteps === undoSteps && redoEnabledAfterRedo === false && undoEnabledAfterRedo === true;
  return {
    ...buildUndoRedoObserved({
      contentChanged: editorFound ? textBeforeTurn !== null && textAfterEdit !== textBeforeTurn : null,
      // A canvas AI turn is visible when it left the host dirty or an entry in the module's own history.
      dirtyAfterEdit: dirtyAfterEdit === true || (!editorFound && nativeUndoEnabledAfterEdit === true),
      undoReverted, redoRestored, undoControl, redoControl,
    }),
    undoReverted, redoRestored, undoSteps, redoSteps, undoVia, redoVia,
    dirtyAfterEdit, dirtyAfterUndo, dirtyAfterRedo, nativeUndoEnabledAfterEdit,
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
    page, frame, hostSelector: sel.host, textBeforeTurn: ctx.textBeforeTurn,
  });
  if (undoRedo.missingControl) {
    return { stop: { missingSelector: undoRedo.missingControl === 'undo' ? NATIVE_UNDO_SELECTOR : NATIVE_REDO_SELECTOR } };
  }
  if (!undoRedo.aiChangeVisibleBeforeSave) {
    // The AI turn left no edit to undo: that is the turn's result, not a broken undo.
    return { stop: failVerdict('ai_change_not_visible_before_save', { undoRedo, aiTurn: ctx.aiTurn ?? null }) };
  }
  if (!undoRedo.aiChangeUndoableBeforeSave) {
    // The change did not survive undo then redo; saving now would write the wrong document.
    return { stop: failVerdict('ai_change_not_undoable_before_save', { failed: undoRedo.undoReverted === true ? 'redo' : 'undo', undoRedo }) };
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
      secondSave: obs.observed.secondSave,
      undoRedo: {
        via: undoRedo.undoVia ?? null, redoVia: undoRedo.redoVia ?? null,
        visible: undoRedo.aiChangeVisibleBeforeSave, undoable: undoRedo.aiChangeUndoableBeforeSave,
        undoReverted: undoRedo.undoReverted ?? null, redoRestored: undoRedo.redoRestored ?? null,
      },
      oldVersion: old.version,
    },
  };
}
