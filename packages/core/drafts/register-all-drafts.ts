/**
 * Side-effect module that imports every module-level draft store so their
 * `registerDraftCleanup` calls have run before any cleanup path executes.
 *
 * Self-registration only knows about stores that have been imported. A cleanup
 * caller importing just its own module would otherwise see an empty registry
 * and skip persisted keys whose store happened not to be loaded — a narrower
 * version of the leak the registry exists to fix.
 *
 * ONE LINE PER DRAFT STORE. Adding a draft store without adding its import
 * here is the rediscovery this module exists to prevent.
 */
import "../tasks/stores/comment-draft-store";
import "../tasks/stores/create-task-draft-store";
import "../tasks/stores/recent-tasks-store";

export {};
