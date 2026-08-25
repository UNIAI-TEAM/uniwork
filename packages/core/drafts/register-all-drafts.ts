/**
 * Side-effect module that imports every module-level draft store so their
 * `registerDraftCleanup` calls have run before any cleanup path executes.
 *
 * Self-registration only knows about stores that have been imported. A cleanup
 * caller importing just its own module would otherwise see an empty registry
 * and skip persisted keys whose store happened not to be loaded — a narrower
 * version of the leak the registry exists to fix.
 *
 * UniWork has no draft stores yet. The module exists so `storage-cleanup` has
 * the single import it needs, and so adding the first draft store is one line
 * here rather than a rediscovery of why cleanup missed it.
 */
export {};
