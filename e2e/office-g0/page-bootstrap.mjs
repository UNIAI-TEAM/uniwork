// DOC-003 lab page bootstrap (UNI-667).
//
// The injected module that must finish before the app entry is dynamically
// imported. It asks the lab server to mint the per-page session, builds the
// explicit host on top of the returned view id and installs it. Nothing here is a
// stub: a failure to open the session or install the host stops the page instead
// of letting the editor mount with an undefined host.
//
// The view id is server-issued on purpose. A page-chosen id is not authorization;
// only lab:session-open grants a view, so the bootstrap opens a session even for
// an unsaved blank document (path null) and never invents an id client-side.

import { createHostAdapter, createHostPreferences, createLabTransport } from './host-adapter.mjs';
import { installLabHost } from './host-runtime.mjs';

/** Reads the fixture a page was asked to open; absent means an unsaved document. */
export function fixtureFromLocation(search) {
  const params = new URLSearchParams(search ?? '');
  const fixture = params.get('fixture');
  return fixture && fixture.length > 0 ? fixture : null;
}

/** The app name a lab page serves, from ?app= or the first path segment. */
export function appFromLocation({ search = '', pathname = '' } = {}) {
  const fromQuery = new URLSearchParams(search).get('app');
  if (fromQuery) return fromQuery;
  const segment = String(pathname).split('/').filter(Boolean)[0];
  return segment ?? null;
}

/**
 * Opens the per-page session, builds the host and installs it. Returns the host so
 * a test can drive it without a browser.
 */
export async function bootstrapLabHost({
  app,
  fixture = null,
  baseUrl = '',
  fetchImpl,
  prefs,
  declared,
} = {}) {
  if (!app) throw new Error('lab bootstrap: an app name is required');
  const transport = createLabTransport({ baseUrl, fetchImpl });
  const host = createHostAdapter({
    app,
    transport,
    prefs: prefs ?? createHostPreferences(),
    declared,
  });
  // Always open a session, including for an unsaved document: the server issues the
  // view id and grants, and without it no host call is allowed to run.
  await host.openSession({ path: fixture });
  installLabHost(host);
  return host;
}

/**
 * Boots one page: open the session and install the host first, then import the
 * application entry. The dynamic import is what makes "host before app" a runtime
 * guarantee: the app entry body cannot run before installLabHost has completed.
 *
 * `load` is the generated bootstrap's own literal `() => import('./main.tsx')`, so
 * the bundler can split the app entry into its own chunk and evaluate it only after
 * the host is installed. A variable specifier would be left untransformed by the
 * bundler, so `entry`/`importer` remain available for tests only.
 */
export async function bootLabPage({ app, fixture, load, entry, importer, target = globalThis, ...rest } = {}) {
  if (!app) throw new Error('lab bootstrap: an app name is required');
  if (typeof load !== 'function' && !entry) {
    throw new Error('lab bootstrap: an entry loader is required');
  }
  const loadEntry = load ?? importer ?? ((specifier) => import(specifier));
  const host = await bootstrapLabHost({ app, fixture: fixture ?? null, ...rest });
  // Every boot settles the target's binding, including a non-sheets boot, which
  // releases any sheets binding it finds. Only sheets installs one chord, and it is
  // the ONLY thing that turns a keystroke into a menu action.
  let saveChord = null;
  try {
    saveChord = installLabSaveChord({ app, host, target });
    host.saveChord = saveChord ?? undefined;
    await (typeof load === 'function' ? load() : loadEntry(entry));
  } catch (error) {
    // A boot whose entry never loaded leaves no durable binding behind; the host is
    // never handed out because the error propagates.
    removeLabSaveChord(target, saveChord);
    throw error;
  }
  return host;
}

const SAVE_CHORD_KEY = 's';
/**
 * The one chord the lab binds for sheets. 'save' only for an unconsumed Ctrl/Cmd+S;
 * The one chord the lab binds for sheets. 'save' only for an UNCONSUMED Ctrl/Cmd+S:
 * composition, auto-repeat, Alt, Shift, defaultPrevented, no-modifier and every other
 * key return null, so nothing else is consumed and the renderer keeps its own handling.

 */
export function sheetsSaveAction(event, app) {
  if (!event || app !== 'sheets') return null;
  if (event.isComposing === true || event.repeat === true) return null;
  // A handler that already consumed the chord (defaultPrevented) wins: the lab must

  // never deliver a second save for an event someone else handled.

  if (event.defaultPrevented === true) return null;

  if (event.ctrlKey !== true && event.metaKey !== true) return null;
  if (event.altKey === true || event.shiftKey === true) return null;
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key !== SAVE_CHORD_KEY) return null;
  return 'save';
}
/** One LIVE binding per event target; the newest boot on a target owns it. */
const saveChordBindings = new WeakMap();
/**
 * Settles one target's binding and returns THIS boot's record, or null.
 * Ownership is per TARGET, never per host and never a module global, so two targets
 * stay independent. A new sheets boot on a used target removes the previous listener
 * and installs its own, so a stale session can never keep receiving saves; a
 * non-sheets boot removes any binding it finds and installs nothing.
 */
export function installLabSaveChord({ app, host, target = globalThis } = {}) {
  if (!target || typeof target.addEventListener !== 'function') return null;
  const previous = saveChordBindings.get(target);
  if (app !== 'sheets' || !host || typeof host.deliver !== 'function') {
    if (previous) removeLabSaveChord(target, previous);
    return null;
  }
  if (previous) removeLabSaveChord(target, previous);
  const listener = (event) => {
    // A listener that is no longer the live binding of this target is inert: this
    // is what makes a superseded dispose harmless.
    const live = saveChordBindings.get(target);
    if (!live || live.listener !== listener) return;
    const action = sheetsSaveAction(event, live.app);
    if (action === null) return; // never touches another key or another modifier
    if (typeof event.preventDefault === 'function') event.preventDefault();
    live.host.deliver('onMenuAction', action);
  };
  const record = { app, host, target, listener, dispose: () => removeLabSaveChord(target, record) };
  target.addEventListener('keydown', listener, { capture: true, passive: false });
  saveChordBindings.set(target, record);
  return record;
}
/**
 * Removes the live binding of one target. An explicit record is honoured only when
 * it IS the live binding, so an old record's dispose can never take the new boot's
 * listener away. Returns false when nothing changed.
 */
export function removeLabSaveChord(target = globalThis, record) {
  const live = target ? saveChordBindings.get(target) : undefined;
  if (!live) return false;
  if (record && live !== record) return false;
  if (typeof target.removeEventListener === 'function') {
    target.removeEventListener('keydown', live.listener, { capture: true });
  }
  saveChordBindings.delete(target);
  return true;
}
