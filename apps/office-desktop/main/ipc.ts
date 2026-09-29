/** Main owns validation/dispatch; the wire schemas live in shared/ so preload
 * can import the contract without importing privileged main-process modules. */
export * from "../shared/ipc";
