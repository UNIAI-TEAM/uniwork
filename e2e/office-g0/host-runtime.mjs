// DOC-003 lab host runtime (UNI-667).
//
// This is the module every transformed renderer file imports. The build rewrites
// `window.desktop` / `window.pdfApi` / ... into `labHostGlobal('desktop')` and
// prepends one `import { labHostGlobal as __labHost } from '@lab/host-runtime'`,
// which the lab vite config aliases to this file. It holds the single explicit
// host object the page bootstrap installed and hands it out through that
// synchronous accessor.
//
// There is no global fallback and no Proxy: if the bootstrap has not run yet, a
// host read fails loudly instead of yielding undefined, which is what makes
// "the injected module is initialized before the app entry is imported" a runtime
// property rather than a comment.

/** The live host namespace; null until installLabHost runs. */
let hostNamespace = null;

/**
 * Installs the host built by the page bootstrap. Must run before the app entry is
 * imported, so a module-scope host read cannot observe a missing host.
 */
export function installLabHost(host) {
  if (!host || typeof host !== 'object' || !host.globals) {
    throw new Error('lab host runtime: installLabHost needs the object returned by createHostAdapter');
  }
  hostNamespace = host.globals;
  return hostNamespace;
}

/** Clears the installed host (test teardown only). */
export function resetLabHost() {
  hostNamespace = null;
}

/** True once the bootstrap has installed a host. */
export function isLabHostInstalled() {
  return hostNamespace !== null;
}

/**
 * The accessor every transformed module calls. It throws by name when the
 * bootstrap has not installed the host, so an early read is a clear failure
 * rather than a silent undefined that the editor would treat as "no preload".
 */
export function labHostGlobal(globalName) {
  if (!hostNamespace) {
    throw new Error(
      'lab host runtime: the injected host is not initialized; the page bootstrap must install it before importing the app entry',
    );
  }
  const value = hostNamespace[globalName];
  if (!value) throw new Error('lab host runtime: no host global named ' + globalName);
  return value;
}
