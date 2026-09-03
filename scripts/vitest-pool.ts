export type VitestPoolOptions = {
  pool?: "forks" | "threads" | "vmThreads";
  maxWorkers?: number;
  testTimeout?: number;
  hookTimeout?: number;
};

/** WSL mounts of Windows drives (/mnt/c, /mnt/d, …) are slow for Vitest fork workers. */
function isWslWindowsMount(cwd = process.cwd()): boolean {
  return process.platform === "linux" && /^\/mnt\/[a-z]\//i.test(cwd.replace(/\\/g, "/"));
}

/** Prefer threads + fewer workers when the repo sits on a cross-filesystem mount. */
export function vitestPoolOptions(cwd = process.cwd()): VitestPoolOptions {
  if (!isWslWindowsMount(cwd)) return {};

  return {
    pool: "threads",
    maxWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  };
}
